// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildStandaloneHtml,
  documentTitle,
  escapeHtml,
  inlineKatexFonts,
} from "./exportHtml";

describe("escapeHtml", () => {
  it("escapes the characters that could break out of markup", () => {
    expect(escapeHtml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Título — año 2026")).toBe("Título — año 2026");
  });
});

describe("documentTitle", () => {
  it("uses the first heading of the document", () => {
    expect(documentTitle("# My paper\n\ntext", "untitled")).toBe("My paper");
    expect(documentTitle("intro\n\n## Later heading\n", "untitled")).toBe("Later heading");
  });

  it("falls back to the file name without headings", () => {
    expect(documentTitle("just text\n", "notes")).toBe("notes");
    expect(documentTitle("", "notes")).toBe("notes");
  });

  it("ignores a hash that is not a heading", () => {
    expect(documentTitle("a # b\n", "notes")).toBe("notes");
  });
});

describe("inlineKatexFonts", () => {
  // KaTeX ships its stylesheet pointing at fonts by path; the bundler rewrites
  // those paths and adds a hash. Both spellings must end up embedded, or the
  // exported file loses its maths font.
  const cases = [
    ["as shipped", "url(fonts/KaTeX_Main-Regular.woff2)"],
    ["as bundled", "url(/assets/KaTeX_Main-Regular-BwdEyMDf.woff2)"],
    ["quoted", `url("fonts/KaTeX_Main-Regular.woff2")`],
    ["with a query", "url(fonts/KaTeX_Main-Regular.woff2?v=1)"],
  ] as const;

  for (const [label, url] of cases) {
    it(`rewrites a font URL ${label}`, () => {
      const css = `@font-face{font-family:KaTeX_Main;src:${url} format("woff2");}`;
      const out = inlineKatexFonts(css);
      expect(out, "the path must not survive").not.toContain("KaTeX_Main-Regular.woff2");
      expect(out).toContain("url(data:");
    });
  }

  it("drops the woff and ttf fallbacks", () => {
    const css =
      "@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format(\"woff2\")," +
      "url(fonts/KaTeX_Main-Regular.woff) format(\"woff\")," +
      "url(fonts/KaTeX_Main-Regular.ttf) format(\"truetype\");}";
    const out = inlineKatexFonts(css);
    expect(out).not.toContain(".woff)");
    expect(out).not.toContain(".ttf)");
  });

  it("leaves declarations it does not recognise alone", () => {
    const css = "@font-face{font-family:Other;src:url(fonts/Other-Regular.woff2);}";
    expect(inlineKatexFonts(css)).toBe(css);
  });
});

describe("buildStandaloneHtml", () => {
  const base = { title: "Doc", bodyHtml: "<p>hi</p>", lang: "en", dir: "ltr" as const };

  it("produces a complete document with the content inlined", () => {
    const html = buildStandaloneHtml(base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Doc</title>");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain('class="markdown-body doc"');
  });

  it("embeds the styles instead of linking them", () => {
    const html = buildStandaloneHtml(base);
    expect(html).toContain("<style>");
    // No external resource may be referenced: the file must open offline.
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
    // The document stylesheet travels with the file.
    expect(html).toContain(".markdown-body.doc");
  });

  it("escapes the title", () => {
    const html = buildStandaloneHtml({ ...base, title: '</title><script>x' });
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;x");
    expect(html).not.toContain("<script>x");
  });

  it("carries the language and direction of the interface", () => {
    const rtl = buildStandaloneHtml({ ...base, lang: "ar", dir: "rtl" });
    expect(rtl).toContain('<html lang="ar" dir="rtl">');
    const ltr = buildStandaloneHtml(base);
    expect(ltr).toContain('<html lang="en" dir="ltr">');
  });

  it("appends the extra stylesheets it is given", () => {
    const html = buildStandaloneHtml({ ...base, extraCss: [".katex { color: red }"] });
    expect(html).toContain(".katex { color: red }");
  });
});
