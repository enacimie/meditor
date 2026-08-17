// @vitest-environment jsdom
/**
 * End-to-end check of the HTML export: real markdown in, a complete document
 * out. Mermaid is mocked (it needs a browser canvas), the rest of the pipeline
 * — markdown-it, KaTeX, highlight.js — runs for real.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./mermaidPool", () => ({
  getMermaidCache: () => ({ get: vi.fn(), set: vi.fn(), clear: vi.fn() }),
  getMermaidPool: async () => {
    throw new Error("no worker in tests");
  },
  renderMermaidMainThread: async () => "<svg><g/></svg>",
  clearMermaidCache: vi.fn(),
  destroyMermaidPool: vi.fn(),
}));

const { exportMarkdownToHtml } = await import("./exportHtml");

const t = ((key: string) => key) as never;

describe("exportMarkdownToHtml", () => {
  it("renders markdown into a self-contained document", async () => {
    const html = await exportMarkdownToHtml(
      "# Report\n\nSome **bold** text and a [link](https://example.org).\n\n" +
        "| a | b |\n| - | - |\n| 1 | 2 |\n",
      { fileName: "report", lang: "en", rtl: false, t },
    );

    expect(html.startsWith("<!doctype html>")).toBe(true);
    // Title comes from the first heading.
    expect(html).toContain("<title>Report</title>");
    // Markdown actually became HTML.
    expect(html).toContain("<strong>bold</strong>");
    // The renderer tags blocks with data-line for editor↔preview sync.
    expect(html).toMatch(/<table[\s>]/);
    expect(html).toContain('href="https://example.org"');
    // Styles travel inside the file; nothing is fetched at open time.
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\b/);
  }, 20000);

  it("includes the KaTeX stylesheet only when the document has math", async () => {
    const withMath = await exportMarkdownToHtml("$e^{i\\pi}+1=0$\n", {
      fileName: "math",
      lang: "en",
      rtl: false,
      t,
    });
    expect(withMath).toContain("katex");
    // The stylesheet is embedded, not linked.
    expect(withMath).not.toMatch(/<link\b/);

    const withoutMath = await exportMarkdownToHtml("plain text\n", {
      fileName: "plain",
      lang: "en",
      rtl: false,
      t,
    });
    expect(withoutMath).not.toContain("katex");
  }, 20000);

  it("marks right-to-left documents", async () => {
    const html = await exportMarkdownToHtml("# عنوان\n", {
      fileName: "doc",
      lang: "ar",
      rtl: true,
      t,
    });
    expect(html).toContain('<html lang="ar" dir="rtl">');
  }, 20000);
});
