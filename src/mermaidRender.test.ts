// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MermaidCache,
  clearMermaidCache,
  getMermaidCache,
  renderMermaidMainThread,
} from "./mermaidRender";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

// Mermaid's real SVG renderer needs browser layout APIs that jsdom does not
// provide, so the package boundary is mocked and what is tested is the
// adapter around it: the theme it is initialised with, and the cache.
vi.mock("mermaid", () => ({ default: mermaidMock }));

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

  it("keeps the light and dark drawings of one diagram apart", () => {
    // The bug this exists for: keyed on the source alone, switching themes
    // regenerated nothing — the cache handed back the picture drawn for the
    // other theme, so a dark page kept its light diagram for ever.
    cache.set("graph TD; A-->B", "<svg>light</svg>", "default");
    cache.set("graph TD; A-->B", "<svg>dark</svg>", "dark");

    expect(cache.get("graph TD; A-->B", "default")).toBe("<svg>light</svg>");
    expect(cache.get("graph TD; A-->B", "dark")).toBe("<svg>dark</svg>");
  });

  it("has nothing for a theme it has not drawn yet", () => {
    cache.set("src", "<svg>light</svg>", "default");
    expect(cache.get("src", "dark")).toBeUndefined();
  });

  it("treats an unstated theme as the light one", () => {
    // Every caller but the web preview leaves it out, and they all mean paper.
    cache.set("src", "<svg>light</svg>");
    expect(cache.get("src", "default")).toBe("<svg>light</svg>");
    cache.set("other", "<svg>x</svg>", "default");
    expect(cache.get("other")).toBe("<svg>x</svg>");
  });
});

/* ---- the shared cache ---- */
describe("the shared cache", () => {
  beforeEach(() => {
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

describe("renderMermaidMainThread", () => {
  beforeEach(() => {
    mermaidMock.initialize.mockReset();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({ svg: "<svg>drawn</svg>" });
  });

  it("draws with the theme it is given", async () => {
    // Mermaid picks its palette when `initialize` is called, so the theme has
    // to arrive there and not merely be passed along.
    await renderMermaidMainThread("mmd-1", "graph TD; A-->B", "dark");
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
  });

  it("draws light when nothing asks otherwise", async () => {
    await renderMermaidMainThread("mmd-2", "graph TD; A-->B");
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
  });

  it("hands back the SVG mermaid produced", async () => {
    expect(await renderMermaidMainThread("mmd-3", "graph TD; A-->B")).toBe(
      "<svg>drawn</svg>",
    );
  });
});
