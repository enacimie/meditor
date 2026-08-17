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
// Vite emits KaTeX's stylesheet as an asset of its own; `?url` gives its
// address so the text can be fetched and embedded. Importing it as a module
// would only register it as a stylesheet of this chunk, which is why the
// earlier `?inline`/`?raw` attempts resolved to an empty string.
import katexCssUrl from "katex/dist/katex.min.css?url";

/** Escape a string for use in HTML text nodes and quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Title for the exported document: its first heading, else the file name.
 *
 * Fenced blocks are skipped, so a shell comment like `# Install dependencies`
 * inside a ```bash block does not end up as the document's title.
 */
export function documentTitle(markdown: string, fallback: string): string {
  let inFence = false;
  let fence = "";
  for (const line of markdown.split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fence = fenceMatch[1][0];
      } else if (fenceMatch[1][0] === fence) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    const title = heading?.[1]?.trim();
    if (title) return title;
  }
  return fallback;
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

/**
 * KaTeX's stylesheet points at its fonts with paths that only resolve next to
 * the application (`url(fonts/KaTeX_Main-Regular.woff2)`), so an exported file
 * opened from another folder loses them: the formulas fall back to a generic
 * font and the large delimiters, integrals and radicals break.
 *
 * Each font is imported as a data URI so the stylesheet can be rewritten to
 * carry them inside.
 */
const KATEX_FONTS = import.meta.glob("/node_modules/katex/dist/fonts/*.woff2", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Replace KaTeX's font URLs with the embedded data URIs.
 *
 * Matches on the file name, so it works both with the stylesheet as shipped
 * (`url(fonts/KaTeX_Main-Regular.woff2)`) and with the one Vite rewrites for
 * the bundle (`url(/assets/KaTeX_Main-Regular-a1b2c3.woff2)`).
 */
export function inlineKatexFonts(css: string): string {
  const byName = new Map<string, string>();
  for (const [path, dataUri] of Object.entries(KATEX_FONTS)) {
    const name = path.split("/").pop()?.replace(/\.woff2$/, "");
    if (name) byName.set(name, dataUri);
  }
  /** Embedded font whose name matches this URL, bundle hash included or not. */
  const lookup = (url: string): string | undefined => {
    const file = (url.split("/").pop() ?? "").replace(/\.woff2.*$/, "");
    const exact = byName.get(file);
    if (exact) return exact;
    // The bundler appends a hash: KaTeX_Main-Regular-BwdEyMDf.woff2
    for (const [name, dataUri] of byName) {
      if (file.startsWith(`${name}-`)) return dataUri;
    }
    return undefined;
  };

  // Rewrite whole `src:` declarations so the woff/ttf fallbacks disappear with
  // them: every current browser takes the woff2, and carrying three copies of
  // each font would triple the size of the exported file for nothing.
  return css.replace(/src:[^;}]*/g, (declaration) => {
    const sources: string[] = [];
    const urlRe = /url\(\s*["']?([^)"']+?\.woff2[^)"']*)["']?\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = urlRe.exec(declaration)) !== null) {
      const dataUri = lookup(match[1]);
      if (dataUri) sources.push(`url(${dataUri}) format("woff2")`);
    }
    // Leave it untouched when nothing matched, so an unexpected KaTeX layout
    // degrades instead of losing the rule entirely.
    return sources.length ? `src:${sources.join(",")}` : declaration;
  });
}

/**
 * Load KaTeX's stylesheet only when the rendered document contains math.
 *
 * The stylesheet is fetched from the asset Vite emits for it. Importing it as
 * a module does not work: because it lives in node_modules, Vite registers it
 * as a stylesheet of this chunk and both `?inline` and `?raw` resolve to an
 * empty string — which is why nothing was being embedded at all.
 */
async function katexCssIfNeeded(bodyHtml: string): Promise<string[]> {
  if (!bodyHtml.includes("katex")) return [];
  try {
    const response = await fetch(katexCssUrl);
    if (!response.ok) return [];
    return [inlineKatexFonts(await response.text())];
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

  return buildStandaloneHtml({
    title: documentTitle(markdown, fileName),
    bodyHtml,
    lang,
    dir: rtl ? "rtl" : "ltr",
    extraCss: await katexCssIfNeeded(bodyHtml),
  });
}
