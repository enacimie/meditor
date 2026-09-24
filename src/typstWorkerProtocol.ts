/**
 * What the page and the Typst worker say to each other.
 *
 * The page asks for a document compiled to SVG (the preview) or to PDF (the
 * export) and the worker answers with it, or with the error the compiler gave.
 * Kept apart from both ends so it can be tested without either.
 */
import type { TypstFile } from "./typstFiles";

export type TypstRequest = {
  id: number;
  kind: "svg" | "pdf";
  mainContent: string;
  /**
   * The page's address, which the fonts are served beside. A worker knows
   * only its own script's, which is not the same place.
   */
  fontBase: string;
  /**
   * The document's own path in the compiler's view of its folder,
   * `/report.typ`, so that the paths it writes resolve beside it. Absent for
   * a document with no folder, which compiles on its own.
   */
  mainPath?: string;
  /** What changed in the compiler's view of that folder since the last request. */
  files?: TypstFilesDelta;
};

/**
 * Files to put into, and take out of, the compiler's view of the folder.
 *
 * Only what changed crosses: the compiler keeps what it was given, and a
 * figure of several megabytes should not be copied into the worker on every
 * pause in typing.
 */
export type TypstFilesDelta = {
  /** Start from an empty folder first: the files there are another document's. */
  reset: boolean;
  set: Array<{ path: string; bytes: Uint8Array }>;
  drop: string[];
};

export type TypstReply =
  | { id: number; svg: string }
  | { id: number; pdf: Uint8Array | undefined }
  | { id: number; error: string };

/** What the page asks for: the document, and the folder it reads from if it has one. */
export type TypstInput = {
  mainContent: string;
  folder?: {
    /** Which document's folder: the files held for another are dropped. */
    id: string;
    /** The document's own path, `/report.typ`. */
    mainPath: string;
    /** Every file it reads, by path within the folder (typstFiles.ts). */
    files: Map<string, TypstFile>;
  };
};

/** Typst, as the page sees it. */
export interface TypstApi {
  svg(input: TypstInput): Promise<string>;
  pdf(input: TypstInput): Promise<Uint8Array | undefined>;
}

type CompileOptions = { mainContent: string } | { mainFilePath: string; root: string };

/** The part of typst.ts's snippet the worker uses. */
export interface TypstSnippet {
  svg(options: CompileOptions): Promise<string>;
  pdf(options: CompileOptions): Promise<Uint8Array | undefined>;
  addSource(path: string, source: string): Promise<void>;
  mapShadow(path: string, content: Uint8Array): Promise<void>;
  unmapShadow(path: string): Promise<void>;
  resetShadow(): Promise<void>;
}

export type Answer = { reply: TypstReply; transfer: Transferable[] };

/** The part of a worker's global scope the worker uses, so a test can stand one in. */
export type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<TypstRequest>) => void): void;
  postMessage(message: TypstReply, transfer: Transferable[]): void;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Answer requests one at a time, in the order they came.
 *
 * The files a request puts into the compiler's view stay there for the next,
 * which is what saves copying them each time; the price is that one request's
 * files must not land in the middle of another's compile.
 */
export function oneAtATime(
  answerOne: (request: TypstRequest) => Promise<Answer>,
): (request: TypstRequest) => Promise<Answer> {
  let last: Promise<unknown> = Promise.resolve();
  return (request) => {
    const next = last.then(() => answerOne(request));
    last = next.catch(() => undefined);
    return next;
  };
}

/**
 * Answer one request with `typst`: the reply, and the buffers that can be
 * moved to the page rather than copied (a PDF's bytes).
 *
 * A compile error is an answer too. It is turned into its message here, where
 * it can still be read: what crosses to the page has to survive being cloned.
 */
export async function answer(typst: TypstSnippet, request: TypstRequest): Promise<Answer> {
  try {
    const files = request.files;
    if (files?.reset) await typst.resetShadow();
    for (const path of files?.drop ?? []) await typst.unmapShadow(path);
    for (const file of files?.set ?? []) await typst.mapShadow(file.path, file.bytes);
    let options: CompileOptions = { mainContent: request.mainContent };
    if (request.mainPath) {
      await typst.addSource(request.mainPath, request.mainContent);
      // The folder is the root, as it is for the Typst CLI run from it: a
      // path written from `/` means the folder's top, never the disk's.
      options = { mainFilePath: request.mainPath, root: "/" };
    }
    if (request.kind === "svg") {
      const svg = await typst.svg(options);
      return { reply: { id: request.id, svg }, transfer: [] };
    }
    const pdf = await typst.pdf(options);
    return { reply: { id: request.id, pdf }, transfer: pdf ? [pdf.buffer as ArrayBuffer] : [] };
  } catch (error) {
    return { reply: { id: request.id, error: messageOf(error) }, transfer: [] };
  }
}

/**
 * Answer every request that reaches `scope`, one at a time, with the snippet
 * `snippetFor` gives.
 *
 * Whatever goes wrong, the request is answered, even when it goes wrong
 * before the compiler is reached. The page waits for each reply by its id,
 * and one that never comes would leave the preview compiling for good.
 */
export function serve(scope: WorkerScope, snippetFor: (request: TypstRequest) => TypstSnippet): void {
  const respond = oneAtATime((request) => answer(snippetFor(request), request));
  scope.addEventListener("message", (event) => {
    const request = event.data;
    respond(request).then(
      ({ reply, transfer }) => scope.postMessage(reply, transfer),
      (error: unknown) => scope.postMessage({ id: request.id, error: messageOf(error) }, []),
    );
  });
}
