/**
 * Standalone HTML export for Marp decks.
 *
 * Renders every slide and wraps them in a single self-contained page: Marp's
 * scoped theme CSS plus KaTeX with its fonts inlined, no scripts and no
 * external references, so the deck opens anywhere with no network access.
 * Slides stack for reading; printing puts one on each page.
 */
import { renderMarp } from "./marpEngine";
import { documentTitle, escapeHtml, katexCssIfNeeded } from "./exportHtml";
import { renderMermaidBlocks } from "./previewRenderer";
import type { TranslationFn } from "./i18n/translations";

const MARP_EXPORT_CSS = `
html, body { margin: 0; padding: 0; }
body { background: #252526; }
.marpit {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 1000px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}
.marpit svg[data-marpit-svg] {
  display: block;
  width: 100%;
  height: auto;
  flex-shrink: 0;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
}
@media print {
  body { background: #fff; }
  .marpit { gap: 0; max-width: none; padding: 0; }
  .marpit svg[data-marpit-svg] {
    box-shadow: none;
    border-radius: 0;
    width: 100%;
    page-break-after: always;
    break-after: page;
  }
}
@page { margin: 0; }
`;

export async function exportMarpToHtml(
  markdown: string,
  {
    fileName,
    lang,
    rtl,
    t,
  }: { fileName: string; lang: string; rtl: boolean; t: TranslationFn },
): Promise<string> {
  const { html, css } = renderMarp(markdown);
  // Diagram any mermaid fences into the slide markup before serialising, so
  // the exported deck carries the rendered SVGs rather than raw code blocks.
  const host = document.createElement("div");
  host.innerHTML = html;
  const seqRef = { current: 0 };
  await renderMermaidBlocks(host, seqRef, () => false, t);
  const bodyHtml = host.innerHTML;
  const extraCss = await katexCssIfNeeded(bodyHtml);
  const styles = [MARP_EXPORT_CSS, css, ...extraCss]
    .filter((block) => block.trim().length > 0)
    .join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="meditor">
<title>${escapeHtml(documentTitle(markdown, fileName))}</title>
<style>
${styles}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
