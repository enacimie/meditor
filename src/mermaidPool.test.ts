// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Workers can't run in jsdom — mock the worker module
vi.mock("./mermaid.worker?worker", () => ({
  default: class MockWorker {
    onmessage: ((_e: MessageEvent) => void) | null = null;
    onerror: ((_e: ErrorEvent) => void) | null = null;
    constructor() {
      // Simulate async worker init — runs after onmessage is assigned
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", { data: { type: "ready" } }),
          );
        }
      }, 0);
    }
    postMessage(_msg: unknown) {}
    terminate() {}
  },
}));

import {
  MermaidCache,
  MermaidPool,
  getMermaidCache,
  clearMermaidCache,
  getMermaidPool,
  destroyMermaidPool,
  renderMermaidMainThread,
} from "./mermaidPool";

/* ---- MermaidCache ---- */
describe("MermaidCache", () => {
  let cache: MermaidCache;

  beforeEach(() => {
    cache = new MermaidCache();
  });

  it("returns undefined for a missing key", () => {
    expect(cache.get("graph TD; A-->B")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    cache.set("src", "<svg>hello</svg>");
    expect(cache.get("src")).toBe("<svg>hello</svg>");
  });

  it("promotes recently accessed keys (LRU)", () => {
    for (let i = 0; i < 30; i++) {
      cache.set(`key-${i}`, `val-${i}`);
    }
    expect(cache.get("key-0")).toBe("val-0");
    cache.set("key-30", "val-30");
    expect(cache.get("key-1")).toBeUndefined();
    expect(cache.get("key-0")).toBe("val-0");
    expect(cache.get("key-30")).toBe("val-30");
  });

  it("overwrites existing key without increasing size", () => {
    cache.set("key", "old");
    cache.set("key", "new");
    expect(cache.get("key")).toBe("new");
  });

  it("clear() removes all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("handles empty string keys", () => {
    cache.set("", "empty-key-value");
    expect(cache.get("")).toBe("empty-key-value");
  });
});

/* ---- MermaidPool singletons ---- */
describe("MermaidPool singletons", () => {
  beforeEach(() => {
    destroyMermaidPool();
    clearMermaidCache();
  });

  it("getMermaidCache returns singleton", () => {
    clearMermaidCache();
    const c1 = getMermaidCache();
    const c2 = getMermaidCache();
    expect(c1).toBe(c2);
    clearMermaidCache();
    const c3 = getMermaidCache();
    expect(c1).not.toBe(c3);
  });

  it("clearMermaidCache resets singleton", () => {
    clearMermaidCache();
    const c1 = getMermaidCache();
    c1.set("x", "y");
    clearMermaidCache();
    const c2 = getMermaidCache();
    expect(c2.get("x")).toBeUndefined();
  });
});

/* ---- MermaidPool class ---- */
describe("MermaidPool", () => {
  afterEach(() => {
    destroyMermaidPool();
  });

  it("constructs with given worker count", () => {
    const pool = new MermaidPool(2);
    pool.destroy();
    expect(true).toBe(true);
  });

  it("waitReady resolves when mock workers initialise", async () => {
    const pool = new MermaidPool(1);
    await pool.waitReady();
    expect(true).toBe(true);
    pool.destroy();
  });

  it("throws 'Worker not ready' when rendering before waitReady", async () => {
    const pool = new MermaidPool(1);
    await expect(pool.render(1, "graph TD")).rejects.toThrow(
      "Worker not ready",
    );
    pool.destroy();
  });

  it("destroy() cleans up without errors", () => {
    const pool = new MermaidPool(2);
    pool.destroy();
    expect(true).toBe(true);
  });

  it("getMermaidPool returns singleton", async () => {
    destroyMermaidPool();
    const p1 = await getMermaidPool();
    const p2 = await getMermaidPool();
    expect(p1).toBe(p2);
    destroyMermaidPool();
  });

  it("destroyMermaidPool resets singleton", async () => {
    destroyMermaidPool();
    const p1 = await getMermaidPool();
    destroyMermaidPool();
    const p2 = await getMermaidPool();
    expect(p1).not.toBe(p2);
    destroyMermaidPool();
  });
});

/* ---- renderMermaidMainThread ----
   NOTE: These tests require real browser SVG APIs (getBBox, etc.)
   that are not available in jsdom. They are skipped here but work
   correctly when the app runs in a real browser environment.
*/
describe.skip("renderMermaidMainThread", () => {
  it("renders a simple diagram and returns SVG string", async () => {
    const svg = await renderMermaidMainThread(
      "test-mmd",
      "graph TD\n  A --> B",
    );
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<svg");
    expect(svg).toContain("test-mmd");
  }, 15_000);

  it("throws on invalid mermaid syntax", async () => {
    await expect(
      renderMermaidMainThread("bad-id", "not a valid diagram @@@"),
    ).rejects.toThrow();
  }, 15_000);
});
