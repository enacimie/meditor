import type { TranslationFn } from "./i18n/translations";
import { getMermaidCache, getMermaidPool, renderMermaidMainThread } from "./mermaidPool";

/**
 * Fenced-code-block pattern: ```lang\n...\n```
 * Group 1 = fence (backticks), Group 2 = language, Group 3 = body.
 */
const FENCED_BLOCK_RE = /^(`{3,})(\S*)\s*\n([\s\S]*?)^\1\s*$/gm;

const CODE_BLOCK_MAX_LINES = 45;

/**
 * Split fenced code blocks in raw markdown that exceed maxLines so each
 * chunk is independently highlighted by highlight.js.  This avoids broken
 * HTML that results from slicing already-highlighted DOM at arbitrary
 * newline boundaries (which can cut through multi-line token spans).
 */
export function splitLongFencedBlocks(md: string, maxLines = CODE_BLOCK_MAX_LINES): string {
  return md.replace(FENCED_BLOCK_RE, (match, fence, lang, code) => {
    const rawLines = code.split("\n");
    if (rawLines.length && rawLines[rawLines.length - 1] === "") rawLines.pop();
    if (rawLines.length <= maxLines) return match;

    const chunks: string[] = [];
    for (let i = 0; i < rawLines.length; i += maxLines) {
      chunks.push(
        `${fence}${lang}\n${rawLines.slice(i, i + maxLines).join("\n")}\n${fence}`,
      );
    }
    return chunks.join("\n\n");
  });
}

let markdownPromise: Promise<typeof import("./markdown")> | undefined;
let markdownStylesPromise: Promise<unknown[]> | undefined;

async function getMarkdownRenderer() {
  markdownPromise ??= import("./markdown");
  markdownStylesPromise ??= Promise.all([
    import("katex/dist/katex.min.css"),
    import("highlight.js/styles/github.css"),
  ]);
  try {
    const [{ renderMarkdown }] = await Promise.all([
      markdownPromise,
      markdownStylesPromise,
    ]);
    return renderMarkdown;
  } catch {
    // Dynamic import failed (network error, etc.).
    // Don't cache the rejected promise — allow retry on next render.
    markdownPromise = undefined;
    markdownStylesPromise = undefined;
    throw new Error("Failed to load markdown renderer");
  }
}

/**
 * Render markdown content into an HTML element, processing Mermaid diagrams
 * via Web Workers (with main-thread fallback).
 */
export async function renderContent(
  el: HTMLElement,
  value: string,
  seqRef: React.MutableRefObject<number>,
  isStale: () => boolean,
  t: TranslationFn,
): Promise<void> {
  const renderMarkdown = await getMarkdownRenderer();
  if (isStale()) return;
  el.innerHTML = renderMarkdown(value);

  const nodes = Array.from(el.querySelectorAll("code.language-mermaid"));
  if (!nodes.length) return;

  // Try to get worker pool; if unavailable, fall back to main thread
  let pool = null;
  try {
    pool = await getMermaidPool();
  } catch {
    // Worker setup failed; will use main thread for all diagrams
  }

  const cache = getMermaidCache();

  for (const code of nodes) {
    if (isStale()) return;
    const pre = code.parentElement;
    if (!pre) continue;
    const src = code.textContent ?? "";
    const renderId = seqRef.current++;
    const id = `mmd-${renderId}`;
    const line = pre.getAttribute("data-line");

    // Show loading spinner while rendering
    const placeholder = document.createElement("div");
    placeholder.className = "mermaid-loading";
    placeholder.innerHTML =
      '<span class="mermaid-spinner"></span> Rendering diagram…';
    if (line) placeholder.setAttribute("data-line", line);
    pre.replaceWith(placeholder);

    let svg: string | null = null;
    let error: string | null = null;

    const cached = cache.get(src);
    if (cached) {
      svg = cached;
    } else if (pool) {
      try {
        svg = await pool.render(renderId, src);
      } catch {
        // Worker render failed (expected when DOMPurify is unavailable
        // in the shim DOM).  Fall back silently to main thread.
        try {
          svg = await renderMermaidMainThread(id, src);
          error = null;
        } catch (mainErr) {
          error = mainErr instanceof Error ? mainErr.message : String(mainErr);
        }
      }
    } else {
      try {
        svg = await renderMermaidMainThread(id, src);
      } catch (mainErr) {
        error = mainErr instanceof Error ? mainErr.message : String(mainErr);
      }
    }

    if (svg && !cached) {
      cache.set(src, svg);
    }

    if (isStale()) return;

    let div: HTMLDivElement;
    if (svg) {
      div = document.createElement("div");
      div.className = "mermaid";
      div.innerHTML = svg;
    } else {
      div = document.createElement("div");
      div.className = "mermaid-error";
      div.textContent = t("preview.mermaidError") + " " + (error ?? "Unknown error");
    }
    if (line) div.setAttribute("data-line", line);
    placeholder.replaceWith(div);
  }
}
