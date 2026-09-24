// Typst for the page: the compiler runs in a worker (typstWorker.ts), so the
// page keeps a strict Content-Security-Policy without 'unsafe-eval'. This end
// sends the source over and hands back the SVG or the PDF.

import type {
  TypstApi,
  TypstFilesDelta,
  TypstInput,
  TypstReply,
  TypstRequest,
} from "./typstWorkerProtocol";

/** The part of a Worker the client uses, so a test can stand one in. */
export type WorkerLike = {
  postMessage(message: TypstRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<TypstReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/**
 * A `TypstApi` that forwards to a worker, started on the first request.
 *
 * Replies are matched to requests by id, so a preview and an export can be in
 * flight together. A worker that fails outright (its script did not load, or
 * it threw outside a request) fails every request still waiting and is
 * dropped; the next request starts a new one.
 *
 * It also keeps count of the files the worker holds, so that only what
 * changed is sent: a new file or a new fingerprint, and the paths no longer
 * read. Another document's folder starts the worker's view afresh, and so
 * does a new worker, which holds nothing; a document with no folder empties
 * it.
 */
export function createTypstClient(startWorker: () => WorkerLike, fontBase: () => string): TypstApi {
  let worker: WorkerLike | null = null;
  let nextId = 0;
  const waiting = new Map<number, { resolve: (reply: TypstReply) => void; reject: (error: Error) => void }>();
  /** Whose files the worker holds, and which, by path, with their fingerprints. */
  let heldFor: string | null = null;
  const held = new Map<string, string>();

  const delta = (folder: NonNullable<TypstInput["folder"]>): TypstFilesDelta => {
    const reset = heldFor !== folder.id;
    if (reset) {
      held.clear();
      heldFor = folder.id;
    }
    const set: TypstFilesDelta["set"] = [];
    for (const [path, file] of folder.files) {
      if (held.get(path) === file.key) continue;
      set.push({ path: `/${path}`, bytes: file.bytes });
      held.set(path, file.key);
    }
    const drop: string[] = [];
    for (const path of [...held.keys()]) {
      if (folder.files.has(path)) continue;
      drop.push(`/${path}`);
      held.delete(path);
    }
    return { reset, set, drop };
  };

  const start = (): WorkerLike => {
    const started = startWorker();
    started.onmessage = (event) => {
      const request = waiting.get(event.data.id);
      if (!request) return;
      waiting.delete(event.data.id);
      request.resolve(event.data);
    };
    started.onerror = (event) => {
      // An error from a worker already replaced has nothing left to fail:
      // what is waiting now was sent to its successor.
      if (worker !== started) return;
      worker = null;
      started.terminate();
      // A new worker holds no files: the next request sends them all.
      heldFor = null;
      held.clear();
      const error = new Error(event.message || "the Typst worker stopped");
      for (const request of waiting.values()) request.reject(error);
      waiting.clear();
    };
    return started;
  };

  const ask = async (kind: TypstRequest["kind"], input: TypstInput): Promise<TypstReply> => {
    const reply = await new Promise<TypstReply>((resolve, reject) => {
      worker ??= start();
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      const request: TypstRequest = { id, kind, mainContent: input.mainContent, fontBase: fontBase() };
      if (input.folder) {
        request.mainPath = input.folder.mainPath;
        request.files = delta(input.folder);
      } else if (heldFor !== null) {
        // A document without a folder must not find another's files there.
        request.files = { reset: true, set: [], drop: [] };
        heldFor = null;
        held.clear();
      }
      worker.postMessage(request);
    });
    if ("error" in reply) throw new Error(reply.error);
    return reply;
  };

  return {
    svg: async (input) => ((await ask("svg", input)) as { svg: string }).svg,
    pdf: async (input) => ((await ask("pdf", input)) as { pdf: Uint8Array | undefined }).pdf,
  };
}

const client = createTypstClient(
  () =>
    new Worker(new URL("./typstWorker.ts", import.meta.url), {
      type: "module",
    }) as unknown as WorkerLike,
  () => document.baseURI,
);

export function getTypst(): Promise<{ $typst: TypstApi }> {
  return Promise.resolve({ $typst: client });
}
