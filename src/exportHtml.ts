/**
 * Standalone HTML export.
 *
 * Produces a single self-contained file: the same HTML the Document preview
 * renders (Mermaid diagrams already inlined as sanitized SVG, KaTeX already
 * expanded, images kept as they appear in the document), plus the stylesheets
 * embedded in a <style> block, so the result opens in any browser with no
 * network access and no companion files.
 */
import pagedCss from "./paged.css?inline";
import latexHighlightCss from "./latex-highlight.css?inline";
import type { TranslationFn } from "./i18n/translations";
import { renderContent } from "./previewRenderer";

/** Escape a string for use in HTML text nodes and quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Title for the exported document: its first heading, else the file name. */
export function documentTitle(markdown: string, fallback: string): string {
  const heading = /^#{1,6}\s+(.+?)\s*$/m.exec(markdown);
  const title = heading?.[1]?.trim();
  return title && title.length > 0 ? title : fallback;
}

type BuildOptions = {
  title: string;
  bodyHtml: string;
  lang: string;
  dir: "ltr" | "rtl";
  /** Extra stylesheets to embed (KaTeX is only pulled in when it is used). */
  extraCss?: string[];
};

/** Wrap rendered markdown in a complete, self-contained HTML document. */
export function buildStandaloneHtml({
  title,
  bodyHtml,
  lang,
  dir,
  extraCss = [],
}: BuildOptions): string {
  const styles = [BASE_CSS, pagedCss, latexHighlightCss, ...extraCss]
    .filter((css) => css.trim().length > 0)
    .join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="meditor">
<title>${escapeHtml(title)}</title>
<style>
${styles}
</style>
</head>
<body>
<main class="markdown-body doc">
${bodyHtml}
</main>
</body>
</html>
`;
}

/**
 * Page frame for the exported file. paged.css styles the document itself but
 * assumes a paginated container, so the export supplies the page around it.
 */
const BASE_CSS = `
body {
  margin: 0;
  background: #f5f5f5;
  color: #000;
}
main.markdown-body.doc {
  box-sizing: border-box;
  max-width: 21cm;
  min-height: 29.7cm;
  margin: 1.5rem auto;
  padding: 2.5cm;
  background: #fff;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
}
main.markdown-body.doc img { max-width: 100%; height: auto; }
main.markdown-body.doc svg { max-width: 100%; }
main.markdown-body.doc pre { overflow-x: auto; }
main.markdown-body.doc table { max-width: 100%; }
@media print {
  body { background: #fff; }
  main.markdown-body.doc {
    max-width: none;
    min-height: 0;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }
}
@media (max-width: 22cm) {
  main.markdown-body.doc {
    margin: 0;
    padding: 1.25cm 1rem;
    min-height: 0;
  }
}
`;

/** Load KaTeX's stylesheet only when the rendered document contains math. */
async function katexCssIfNeeded(bodyHtml: string): Promise<string[]> {
  if (!bodyHtml.includes("katex")) return [];
  try {
    const mod = await import("katex/dist/katex.min.css?inline");
    return [mod.default];
  } catch {
    // Without it the formulas still read, just unstyled.
    return [];
  }
}

/**
 * Render `markdown` and return a self-contained HTML document.
 *
 * Rendering needs a live DOM because Mermaid and the sanitizer work on real
 * nodes, so the markdown is rendered into a detached element first.
 */
export async function exportMarkdownToHtml(
  markdown: string,
  { fileName, lang, rtl, t }: { fileName: string; lang: string; rtl: boolean; t: TranslationFn },
): Promise<string> {
  const host = document.createElement("div");
  const seqRef = { current: 0 };
  await renderContent(host, markdown, seqRef, () => false, t);
  const bodyHtml = host.innerHTML;
  host.remove();

  return buildStandaloneHtml({
    title: documentTitle(markdown, fileName),
    bodyHtml,
    lang,
    dir: rtl ? "rtl" : "ltr",
    extraCss: await katexCssIfNeeded(bodyHtml),
  });
}
