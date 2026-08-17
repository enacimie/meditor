import MermaidWorker from "./mermaid.worker?worker";

export type MermaidWorkerMessage =
  | { type: "ready" }
  | { type: "result"; id: number; svg?: string; error?: string };

const WORKER_RENDER_TIMEOUT_MS = 12_000;
const MERMAID_CACHE_SIZE = 30;

/**
 * Least-recently-used cache for rendered Mermaid SVGs, keyed by diagram
 * source.  Avoids re-rendering unchanged diagrams on every preview update.
 */
export class MermaidCache {
  private map = new Map<string, string>();

  get(src: string): string | undefined {
    const svg = this.map.get(src);
    if (svg) {
      this.map.delete(src);
      this.map.set(src, svg);
    }
    return svg;
  }

  set(src: string, svg: string): void {
    if (this.map.size >= MERMAID_CACHE_SIZE) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(src, svg);
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Pool of Mermaid Web Workers for off-main-thread diagram rendering.
 * Falls back to main-thread rendering if the worker fails or times out.
 */
export class MermaidPool {
  private workers: Worker[];
  private nextWorker = 0;
  private pending = new Map<
    number,
    {
      resolve: (svg: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private ready = false;
  private readyPromise: Promise<void>;

  constructor(count = 2) {
    this.workers = [];
    this.readyPromise = this.initWorkers(count);
  }

  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  private initWorkers(count: number): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const worker = new MermaidWorker();
      const promise = new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<MermaidWorkerMessage>) => {
          const msg = e.data;
          if (msg.type === "ready") {
            resolve();
            return;
          }
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          if (msg.svg) {
            pending.resolve(msg.svg);
          } else {
            pending.reject(new Error(msg.error ?? "Unknown worker error"));
          }
        };
        worker.onerror = () => {
          reject(new Error("Mermaid worker failed to initialize"));
          for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error("Mermaid worker crashed"));
            this.pending.delete(id);
          }
        };
      });
      promises.push(promise);
      this.workers.push(worker);
    }
    return Promise.all(promises).then(() => {
      this.ready = true;
    });
  }

  render(id: number, src: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ready) {
        reject(new Error("Worker not ready"));
        return;
      }
      const worker = this.workers[this.nextWorker % this.workers.length];
      this.nextWorker++;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Mermaid render timed out in worker"));
      }, WORKER_RENDER_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, src });
    });
  }

  destroy() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
    }
    this.pending.clear();
    this.ready = false;
  }
}

// Module-level singletons reused across renders
let mermaidCache: MermaidCache | undefined;
let mermaidPool: MermaidPool | undefined;

export function getMermaidCache(): MermaidCache {
  mermaidCache ??= new MermaidCache();
  return mermaidCache;
}

export function clearMermaidCache(): void {
  mermaidCache?.clear();
  mermaidCache = undefined;
}

export async function getMermaidPool(): Promise<MermaidPool> {
  if (!mermaidPool) mermaidPool = new MermaidPool(2);
  try {
    await mermaidPool.waitReady();
    return mermaidPool;
  } catch (error) {
    mermaidPool.destroy();
    mermaidPool = undefined;
    throw error;
  }
}

export function destroyMermaidPool(): void {
  mermaidPool?.destroy();
  mermaidPool = undefined;
}

/** Fallback: render diagram directly in main thread if worker is unavailable. */
export async function renderMermaidMainThread(id: string, src: string): Promise<string> {
  const mermaidModule = await import("mermaid");
  const mermaid = mermaidModule.default;
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
    });
  } catch {
    // Already initialized
  }
  const { svg } = await mermaid.render(id, src);
  return svg;
}
