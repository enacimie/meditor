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
      let sentPaths: string[] | null = null;
      if (input.folder) {
        request.mainPath = input.folder.mainPath;
        request.files = delta(input.folder);
        // delta() prefixes the paths it sends with "/" (the compiler's view
        // of the folder); `held` keys them without it.
        sentPaths = request.files.set.map((file) => file.path.replace(/^\//, ""));
      } else if (heldFor !== null) {
        // A document without a folder must not find another's files there.
        request.files = { reset: true, set: [], drop: [] };
        heldFor = null;
        held.clear();
      }
      // The WASM's mapping calls report failure by returning false, which
      // the bindings turn into nothing this side can see: a file the worker
      // never received would be believed delivered, and every later delta
      // would leave it out. A request that carried files and failed forgets
      // them, so the next attempt sends them again.
      const settle = waiting.get(id);
      waiting.set(id, {
        resolve: (answer) => {
          if ("error" in answer && sentPaths) {
            for (const path of sentPaths) held.delete(path);
          }
          settle?.resolve(answer);
        },
        reject,
      });
      worker.postMessage(request);
    });
    if ("skipped" in reply) return reply;
    if ("error" in reply) {
      if (reply.fatal && worker) {
        /*
         * This worker's compiler never came up, and typst.ts caches the
         * failed initialisation: it will answer every request the same way.
         * Drop it — the next request starts a fresh one — and fail whatever
         * else was queued behind this one, rather than leaving those callers
         * waiting on a worker that no longer exists.
         */
        const dead = worker;
        worker = null;
        heldFor = null;
        held.clear();
        dead.terminate();
        const startup = new Error("the Typst compiler did not start");
        for (const [id, request] of waiting) {
          if (id !== reply.id) request.reject(startup);
        }
        waiting.clear();
      }
      throw new Error(reply.error);
    }
    return reply;
  };

  return {
    svg: async (input) => {
      const reply = await ask("svg", input);
      // An overtaken draft: nobody is waiting for this text anymore (the
      // preview has asked for a newer one and discards what comes back for
      // an older sequence number), so an empty answer is a true one.
      return "svg" in reply ? reply.svg : "";
    },
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
