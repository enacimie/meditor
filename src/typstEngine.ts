// Typst for the page: the compiler runs in a worker (typstWorker.ts), so the
// page keeps a strict Content-Security-Policy without 'unsafe-eval'. This end
// sends the source over and hands back the SVG or the PDF.

import type { TypstApi, TypstReply, TypstRequest } from "./typstWorkerProtocol";

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
 */
export function createTypstClient(startWorker: () => WorkerLike, fontBase: () => string): TypstApi {
  let worker: WorkerLike | null = null;
  let nextId = 0;
  const waiting = new Map<number, { resolve: (reply: TypstReply) => void; reject: (error: Error) => void }>();

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
      const error = new Error(event.message || "the Typst worker stopped");
      for (const request of waiting.values()) request.reject(error);
      waiting.clear();
    };
    return started;
  };

  const ask = async (kind: TypstRequest["kind"], mainContent: string): Promise<TypstReply> => {
    const reply = await new Promise<TypstReply>((resolve, reject) => {
      worker ??= start();
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, kind, mainContent, fontBase: fontBase() });
    });
    if ("error" in reply) throw new Error(reply.error);
    return reply;
  };

  return {
    svg: async ({ mainContent }) => ((await ask("svg", mainContent)) as { svg: string }).svg,
    pdf: async ({ mainContent }) =>
      ((await ask("pdf", mainContent)) as { pdf: Uint8Array | undefined }).pdf,
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
