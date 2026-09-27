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
  | {
      id: number;
      error: string;
      /**
       * The worker itself is broken, not the document: its first compile
       * ever failed, and typst.ts caches the failed initialisation, so
       * nothing this worker attempts next can succeed. The page drops it
       * and the next request starts a fresh one.
       */
      fatal?: boolean;
    }
  /**
   * An SVG request a newer one overtook before the compiler reached it.
   * Answered without compiling: the draft nobody is waiting for anymore
   * must not delay the one they are.
   */
  | { id: number; skipped: true };

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

/** Undo Rust's `Debug` string escaping: `\"`, `\\`, `\n`, `\u{2026}`… */
function unescapeRust(text: string): string {
  return text.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_all, char: string, hex?: string) =>
    hex
      ? String.fromCodePoint(parseInt(hex, 16))
      : char === "n"
        ? "\n"
        : char === "t"
          ? "\t"
          : char === "r"
            ? "\r"
            : char,
  );
}

/** The quoted strings inside a Rust `Debug` list, unescaped. */
function rustList(body: string): string[] {
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unescapeRust(m[1]));
}

/**
 * The compile error as the writer should read it.
 *
 * The snippet API compiles with `diagnostics: 'none'`, and in that mode the
 * WASM throws Rust's own `Debug` dump of the diagnostics — something like
 * `SourceDiagnostic { severity: Error, span: …, trace: [], message:
 * "unknown variable: x", hints: ["…"] }`. The message and the hints inside
 * it are what helps; the struct around them, the span's internal ids and
 * the crate paths are noise. A dump this cannot recognise is passed through
 * untouched: half an error is worse than an ugly one.
 */
export function humanizeTypstError(raw: string): string {
  const diagnostics: string[] = [];
  for (const match of raw.matchAll(
    /message: "((?:[^"\\]|\\.)*)", hints: \[([^\]]*)\]/g,
  )) {
    const hints = rustList(match[2]);
    diagnostics.push(
      hints.length
        ? `${unescapeRust(match[1])} (${hints.join("; ")})`
        : unescapeRust(match[1]),
    );
  }
  return diagnostics.length ? diagnostics.join("\n") : raw;
}

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
    return { reply: { id: request.id, error: humanizeTypstError(messageOf(error)) }, transfer: [] };
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
  /*
   * The newest SVG request seen, and whether this worker has ever compiled
   * anything successfully.
   *
   * Every pause in typing queues a compile, and one-at-a-time means a slow
   * one delays the draft the writer is actually looking at; an overtaken
   * SVG request answers `skipped` without touching the compiler. A PDF is
   * never skipped: each is a file somebody asked for.
   *
   * The first-ever failure is fatal because of how typst.ts initialises:
   * the compiler-instance promise is cached, and a rejected one is cached
   * too, so a worker whose fonts failed to load (or whose WASM refused to
   * start) fails every compile after it the same way. Saying so lets the
   * page drop it and start clean — which is also why "has it ever worked"
   * is the test: after one success, a failure is the document's, not the
   * worker's.
   */
  let newestSvg = -1;
  let healthy = false;
  const respond = oneAtATime(async (request) => {
    if (request.kind === "svg" && request.id < newestSvg) {
      return { reply: { id: request.id, skipped: true as const }, transfer: [] };
    }
    return answer(snippetFor(request), request);
  });
  scope.addEventListener("message", (event: MessageEvent<TypstRequest>) => {
    const request = event.data;
    if (request.kind === "svg" && request.id > newestSvg) newestSvg = request.id;
    respond(request).then(
      ({ reply, transfer }) => {
        if ("error" in reply) {
          // A worker that has never compiled anything and just failed is a
          // worker whose compiler never came up; say so, and the page drops
          // it instead of asking it again. A skipped draft says nothing
          // either way: the compiler was not reached.
          if (!healthy) reply.fatal = true;
        } else if (!("skipped" in reply)) {
          healthy = true;
        }
        scope.postMessage(reply, transfer);
      },
      (error: unknown) => {
        const reply: TypstReply = { id: request.id, error: messageOf(error) };
        if (!healthy) (reply as { fatal?: boolean }).fatal = true;
        scope.postMessage(reply, []);
      },
    );
  });
}
