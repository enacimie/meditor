// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────
const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
};

const mockRenderMainThread = vi.fn();

vi.mock("./mermaidRender", () => ({
  getMermaidCache: () => mockCache,
  renderMermaidMainThread: (id: string, src: string, theme?: string) =>
    mockRenderMainThread(id, src, theme),
  clearMermaidCache: vi.fn(),
}));

// Mock markdown so we can embed <code class="language-mermaid"> blocks
vi.mock("./markdown", () => ({
  renderMarkdown: (src: string) => src,
}));

import { renderContent } from "./previewRenderer";

// ── Helpers ───────────────────────────────────────────────────────

const t = ((key: string) => {
  const map: Record<string, string> = { "preview.mermaidError": "Mermaid:" };
  return map[key] ?? key;
}) as (key: string, ...args: unknown[]) => string;

function makeEl(inner: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = inner;
  document.body.appendChild(div);
  return div;
}

function seqRef(n = 0) {
  return { current: n };
}

function neverStale() {
  return false;
}

/** Build an HTML string with a mermaid fenced block. */
function mdWithMermaid(src: string): string {
  return `<pre><code class="language-mermaid">${src.replace(/</g, "&lt;")}</code></pre>`;
}

// ── Tests ─────────────────────────────────────────────────────────

describe("renderContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderMainThread.mockResolvedValue('<svg id="fallback">OK</svg>');
    mockCache.get.mockReturnValue(undefined);
  });

  // ── No mermaid ───────────────────────────────────────────────

  it("renders plain markdown without touching mermaid", async () => {
    const el = makeEl("<p>Hello World</p>");
    await renderContent(el, "<p>Hello World</p>", seqRef(), neverStale, t);

    expect(el.innerHTML).toBe("<p>Hello World</p>");
    expect(mockRenderMainThread).not.toHaveBeenCalled();
  });

  it("renders empty string", async () => {
    const el = makeEl("");
    await renderContent(el, "", seqRef(), neverStale, t);
  });

  // ── Cache hit ────────────────────────────────────────────────

  it("uses cached SVG when available", async () => {
    const src = "graph TD\n  A-->B";
    const el = makeEl(mdWithMermaid(src));

    mockCache.get.mockReturnValue('<svg id="cached">cached</svg>');

    await renderContent(el, mdWithMermaid(src), seqRef(), neverStale, t);

    expect(el.querySelector(".mermaid")!.innerHTML).toContain("cached");
    expect(el.querySelector(".mermaid-error")).toBeNull();
    expect(mockRenderMainThread).not.toHaveBeenCalled();
  });

  // ── Worker success ───────────────────────────────────────────

  it("draws the diagram and caches what it drew", async () => {
    const src = "graph TD\n  A-->B";
    const el = makeEl(mdWithMermaid(src));

    mockRenderMainThread.mockResolvedValue('<svg id="drawn">drawn</svg>');

    await renderContent(el, mdWithMermaid(src), seqRef(), neverStale, t);

    expect(el.querySelector(".mermaid")!.innerHTML).toContain("drawn");
    expect(mockRenderMainThread).toHaveBeenCalledTimes(1);
    // The theme is part of what is cached: the same diagram drawn light and
    // drawn dark are two pictures, and one must not be handed back for the
    // other.
    expect(mockCache.set).toHaveBeenCalledWith(
      src,
      '<svg id="drawn">drawn</svg>',
      "default",
    );
  });

  it("draws with the theme it was asked for", async () => {
    const src = "graph TD\n  A-->B";
    const el = makeEl(mdWithMermaid(src));
    mockRenderMainThread.mockResolvedValue('<svg id="drawn">drawn</svg>');

    await renderContent(el, mdWithMermaid(src), seqRef(), neverStale, t, undefined, "dark");

    expect(mockRenderMainThread).toHaveBeenCalledWith(
      expect.any(String),
      src,
      "dark",
    );
    expect(mockCache.get).toHaveBeenCalledWith(src, "dark");
    expect(mockCache.set).toHaveBeenCalledWith(
      src,
      '<svg id="drawn">drawn</svg>',
      "dark",
    );
  });

  it("draws light when nothing asks otherwise", async () => {
    // Every caller but the web preview leaves the theme out, and every one of
    // them is paper.
    const src = "graph TD\n  A-->B";
    const el = makeEl(mdWithMermaid(src));
    mockRenderMainThread.mockResolvedValue('<svg id="drawn">drawn</svg>');

    await renderContent(el, mdWithMermaid(src), seqRef(), neverStale, t);

    expect(mockRenderMainThread).toHaveBeenCalledWith(
      expect.any(String),
      src,
      "default",
    );
  });

  it("shows the error when the diagram cannot be drawn", async () => {
    const el = makeEl(mdWithMermaid("bad @@@ syntax"));

    mockRenderMainThread.mockRejectedValue(new Error("main fail"));

    await renderContent(el, mdWithMermaid("bad @@@ syntax"), seqRef(), neverStale, t);

    const err = el.querySelector(".mermaid-error")!;
    expect(err).not.toBeNull();
    expect(err.textContent).toContain("Mermaid:");
    expect(err.textContent).toContain("main fail");
    expect(el.querySelector(".mermaid")).toBeNull();
  });

  it("handles non-Error rejections in the error message", async () => {
    const el = makeEl(mdWithMermaid("bad"));

    mockRenderMainThread.mockRejectedValue(42);

    await renderContent(el, mdWithMermaid("bad"), seqRef(), neverStale, t);

    const err = el.querySelector(".mermaid-error")!;
    expect(err).not.toBeNull();
    expect(err.textContent).toContain("Mermaid:");
  });

  // ── Multiple mermaid blocks ──────────────────────────────────

  it("processes multiple mermaid blocks", async () => {
    const html = [
      mdWithMermaid("graph TD\n  A-->B"),
      "<p>text between</p>",
      mdWithMermaid("graph TD\n  C-->D"),
    ].join("\n");
    const el = makeEl(html);

    let call = 0;
    mockRenderMainThread.mockImplementation(async () => {
      call++;
      return `<svg id="w${call}">diagram-${call}</svg>`;
    });

    await renderContent(el, html, seqRef(), neverStale, t);

    const mermaids = el.querySelectorAll(".mermaid");
    expect(mermaids.length).toBe(2);
    expect(mermaids[0].innerHTML).toContain("diagram-1");
    expect(mermaids[1].innerHTML).toContain("diagram-2");
  });

  // ── data-line preservation ───────────────────────────────────

  it("preserves data-line on success div", async () => {
    const el = makeEl(
      '<pre data-line="5"><code class="language-mermaid">x</code></pre>',
    );
    mockRenderMainThread.mockResolvedValue("<svg>ok</svg>");

    await renderContent(
      el,
      '<pre data-line="5"><code class="language-mermaid">x</code></pre>',
      seqRef(),
      neverStale,
      t,
    );

    expect(el.querySelector(".mermaid")!.getAttribute("data-line")).toBe("5");
  });

  it("preserves data-line on error div", async () => {
    const el = makeEl(
      '<pre data-line="7"><code class="language-mermaid">bad</code></pre>',
    );
    mockRenderMainThread.mockRejectedValue(new Error("fail"));
    mockRenderMainThread.mockRejectedValue(new Error("fail too"));

    await renderContent(
      el,
      '<pre data-line="7"><code class="language-mermaid">bad</code></pre>',
      seqRef(),
      neverStale,
      t,
    );

    expect(el.querySelector(".mermaid-error")!.getAttribute("data-line")).toBe("7");
  });

  // ── Stale check ──────────────────────────────────────────────

  it("returns early when stale after markdown rendering", async () => {
    const html = mdWithMermaid("graph TD\n  A-->B");
    const el = makeEl(html);

    await renderContent(el, html, seqRef(), () => true, t);

    // stale = true immediately after markdown render → we return
    // but the markdown _was_ already rendered into el.innerHTML
    // The mermaid nodes exist but processing was aborted.
    // The mermaid code elements should still be in the DOM (not replaced)
    expect(el.querySelector("code.language-mermaid")).not.toBeNull();
  });

  // ── Orphan code element (impossible in practice) ─────────────
  // markdown-it always wraps code in <pre>, so this scenario is
  // not reachable. The code correctly skips orphan elements.

  // ── Sequence counter ─────────────────────────────────────────

  it("increments sequence ref for each mermaid diagram", async () => {
    const html = [
      mdWithMermaid("graph TD\n  A-->B"),
      mdWithMermaid("graph TD\n  C-->D"),
      mdWithMermaid("graph TD\n  E-->F"),
    ].join("\n");
    const el = makeEl(html);
    const seq = seqRef(10);
    mockRenderMainThread.mockResolvedValue("<svg>x</svg>");

    await renderContent(el, html, seq, neverStale, t);

    expect(seq.current).toBe(13); // 10 + 3
  });

  // ── No loading spinners left behind ──────────────────────────

  it("does not leave loading spinners after render", async () => {
    const src = "graph TD\n  A-->B";
    const el = makeEl(mdWithMermaid(src));
    mockRenderMainThread.mockResolvedValue("<svg>done</svg>");

    await renderContent(el, mdWithMermaid(src), seqRef(), neverStale, t);

    expect(el.querySelector(".mermaid-loading")).toBeNull();
    expect(el.querySelector(".mermaid")).not.toBeNull();
  });

  // ── Cache set on worker success ──────────────────────────────

  it("does NOT re-cache when value was already cached", async () => {
    const src = "graph TD\n  A-->B";
    const el = makeEl(mdWithMermaid(src));

    mockCache.get.mockReturnValue("<svg>cached</svg>");

    await renderContent(el, mdWithMermaid(src), seqRef(), neverStale, t);

    // Cache was hit, so set() should not be called
    expect(mockCache.set).not.toHaveBeenCalled();
  });
});
