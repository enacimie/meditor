import type { TranslationFn } from "./i18n/translations";
import { sanitizeSvg } from "./sanitizeSvg";

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

/** A4's content box is 247 mm tall, which is about 934 px at 96 dpi. */
const PAGE_CONTENT_PX = 934;

/**
 * Past this, a heading group is not worth keeping in one piece: paged.js would
 * have nowhere to put it and would leave a page-sized hole rather than break
 * the rule.
 */
const KEEP_TOGETHER_MAX_PX = PAGE_CONTENT_PX * 0.6;

const HEADING_TAG = /^H[1-6]$/;

/**
 * Keep each heading on the same page as whatever it introduces.
 *
 * `break-after: avoid` on the heading gets most of the way there, but paged.js
 * does not chain it: given `## Section` followed by `### Subsection`, it moves
 * the subsection and its content to the next page and leaves the section title
 * stranded at the foot of the previous one. Turning the run into a single
 * element fixes that, because `break-inside: avoid` *is* honoured.
 *
 * A group is the heading, any headings immediately after it, and the first
 * block that is not a heading — the thing the titles are announcing.
 *
 * Only ever called on the offscreen container that feeds the paginated view,
 * so the web preview, the reverse sync and the HTML export keep working on the
 * flat structure they expect.
 *
 * @param root - container whose direct children are the document's blocks.
 * @param measure - height of an element; injectable because jsdom reports 0.
 */
export function keepHeadingsWithContent(
  root: HTMLElement,
  measure: (el: HTMLElement) => number = (el) => el.offsetHeight,
): void {
  const blocks = Array.from(root.children) as HTMLElement[];
  let i = 0;

  while (i < blocks.length) {
    if (!HEADING_TAG.test(blocks[i].tagName)) {
      i += 1;
      continue;
    }

    let end = i;
    while (end < blocks.length && HEADING_TAG.test(blocks[end].tagName)) end += 1;
    // A heading with nothing after it has nothing to be kept with.
    if (end >= blocks.length) break;

    const group = blocks.slice(i, end + 1);
    const height = group.reduce((total, el) => total + measure(el), 0);

    // Fail open: a zero measure means the container had no layout to offer,
    // and skipping would turn the feature off silently. Grouping something
    // that turns out too tall is the milder failure — paged.js simply splits
    // it, which is what it did before any of this.
    if (height === 0 || height <= KEEP_TOGETHER_MAX_PX) {
      const wrapper = root.ownerDocument.createElement("div");
      wrapper.className = "keep-with-next";
      // The last child decides which sibling rule has to be restored around
      // the wrapper: see the `+` selectors in paged.css.
      const lastTag = group[group.length - 1].tagName;
      if (lastTag === "P") wrapper.classList.add("keep-with-next--p");
      else if (lastTag === "PRE") wrapper.classList.add("keep-with-next--pre");

      root.insertBefore(wrapper, group[0]);
      for (const el of group) wrapper.append(el);
    }

    i = end + 1;
  }
}

/** A4's content box is 160 mm wide, which is about 605 px at 96 dpi. */
const PAGE_CONTENT_WIDTH_PX = 605;

/** A4 landscape content box: 297 mm - 2×2.5 cm margins = 247 mm ≈ 933 px. */
const LANDSCAPE_CONTENT_WIDTH_PX = 933;

/**
 * The steps `paged.css` defines, smallest sacrifice first. Each one trades
 * type size and cell padding for room; the pass stops at the first that fits.
 */
const TABLE_FIT_STEPS = ["table-fit-1", "table-fit-2", "table-fit-3"] as const;

/** Marks a table whose only fitting page is a landscape one. */
const NEEDS_LANDSCAPE_CLASS = "needs-landscape";

/**
 * Shrink tables that are wider than the page until they fit on it.
 *
 * A table cannot be laid out narrower than its intrinsic minimum, and
 * `max-width` cannot push it below that, so past about fourteen columns the
 * cell padding alone outgrows the sheet — seventeen columns spend 544 px of
 * the 605 px available before any text. paged.js then clips at the sheet edge,
 * in print as much as on screen, and the columns past it are missing from the
 * exported PDF with nothing to say so.
 *
 * `paged.css` handles the ordinary case on its own (`max-width` plus
 * `overflow-wrap: anywhere`); this is only for the tables that stay too wide
 * even so. Each table is measured at `min-content` — the width it cannot go
 * below — and given the first step that brings it under the page.
 *
 * Only ever called on the offscreen container that feeds the paginated view,
 * so the web preview and the HTML export keep the markup they expect. The
 * class survives `innerHTML` serialisation, which is how the result reaches
 * paged.js.
 *
 * @param root - container whose descendants may include tables.
 * @param measure - min-content width of an element; injectable because jsdom
 * lays nothing out and reports 0.
 * @param allowLandscape - when true, a table that fits on no portrait step but
 * would fit on an A4 landscape page is marked for one rather than left clipped.
 * paged.css assigns it `@page landscape-table` (933 px of content width).
 * @param landscapeNote - label the table carries so the reader sees the page
 * turned sideways coming (`paged.css ::before` reads it from a data attribute).
 */
export function fitWideTables(
  root: HTMLElement,
  measure: (el: HTMLElement) => number = minContentWidth,
  allowLandscape = false,
  landscapeNote = "",
): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    table.classList.remove(...TABLE_FIT_STEPS, NEEDS_LANDSCAPE_CLASS);

    const natural = measure(table);
    /*
     * Fail closed, unlike keepHeadingsWithContent. There, skipping when the
     * container had no layout turned a nicety off in silence; here it would
     * let a table run off the paper and lose columns from the PDF. Squeezing
     * a narrow table that never needed it is only ugly, so an unmeasurable
     * table gets the smallest type rather than the benefit of the doubt.
     */
    if (natural === 0) {
      table.classList.add(TABLE_FIT_STEPS[TABLE_FIT_STEPS.length - 1]);
      continue;
    }
    if (natural <= PAGE_CONTENT_WIDTH_PX) continue;

    let fits = false;
    for (const step of TABLE_FIT_STEPS) {
      table.classList.remove(...TABLE_FIT_STEPS);
      table.classList.add(step);
      if (measure(table) <= PAGE_CONTENT_WIDTH_PX) {
        fits = true;
        break;
      }
    }
    /*
     * Nothing fits on a portrait page. If landscape is allowed and the table
     * at its smallest step would fit the wider sheet, mark it so paged.css
     * moves just its pages to `@page landscape-table`. A table too wide even
     * for that stays at the smallest step, clipped as before — splitting it is
     * an authoring decision, not an editor's.
     */
    if (!fits && allowLandscape && measure(table) <= LANDSCAPE_CONTENT_WIDTH_PX) {
      table.classList.add(NEEDS_LANDSCAPE_CLASS);
      if (landscapeNote) table.setAttribute("data-landscape-note", landscapeNote);
    }
  }
}

/**
 * The narrowest a table can be laid out. Read by asking for it directly
 * rather than by arithmetic on columns and padding, so the answer accounts for
 * the actual font, the actual content and whatever the stylesheet says.
 */
function minContentWidth(el: HTMLElement): number {
  const width = el.style.width;
  const maxWidth = el.style.maxWidth;
  /*
   * `max-width: 100%` would cap the answer at the container's 21 cm instead of
   * reporting the table's own floor. It cannot hide an overflow — 21 cm is
   * wider than the page — but it can understate one, and the step is picked
   * from how far past the page the table reaches.
   */
  el.style.width = "min-content";
  el.style.maxWidth = "none";
  const measured = el.offsetWidth;
  el.style.width = width;
  el.style.maxWidth = maxWidth;
  return measured;
}

let markdownPromise: Promise<typeof import("./markdown")> | undefined;
let markdownStylesPromise: Promise<unknown[]> | undefined;
let mermaidPromise: Promise<typeof import("./mermaidPool")> | undefined;
let mermaidModule: typeof import("./mermaidPool") | undefined;

function getMermaidTools(): Promise<typeof import("./mermaidPool")> {
  mermaidPromise ??= import("./mermaidPool")
    .then((module) => {
      mermaidModule = module;
      return module;
    })
    .catch((error) => {
      mermaidPromise = undefined;
      throw error;
    });
  return mermaidPromise;
}

/** Release optional Mermaid resources without starting a pending import. */
export function clearMermaidResources(): void {
  if (!mermaidModule) return;
  mermaidModule.clearMermaidCache();
  mermaidModule.destroyMermaidPool();
}

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
/** Shared across every consumer, because the Mermaid pool is a singleton. */
let nextRenderId = 0;

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

  const {
    getMermaidCache,
    getMermaidPool,
    renderMermaidMainThread,
  } = await getMermaidTools();
  if (isStale()) return;

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
    // Module-wide counter: the ids index the shared Mermaid worker pool, so a
    // preview render and an export running at the same time must not hand out
    // the same one — a collision resolves a diagram with somebody else's SVG.
    // seqRef is still advanced so callers keep their own render count.
    seqRef.current++;
    const renderId = nextRenderId++;
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

    if (svg) {
      svg = sanitizeSvg(svg) || null;
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
