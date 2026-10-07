import type { MermaidTheme } from "./mermaidTheme";

/**
 * Rendering Mermaid diagrams, and not rendering the same one twice.
 *
 * This used to hand the work to a pool of Web Workers with a hand-written DOM
 * shim, falling back to the main thread when that failed. It always failed —
 * see the note on `renderMermaidMainThread` — so the fallback was the whole
 * implementation and the pool was two workers started at launch that never
 * drew anything.
 */
const MERMAID_CACHE_SIZE = 30;

/**
 * Least-recently-used cache for rendered Mermaid SVGs.
 *
 * Keyed by theme as well as source: the same diagram drawn light and drawn
 * dark are two different pictures, and keying on the text alone meant that
 * switching themes regenerated nothing — the cache handed back the drawing
 * made for the other one.
 */
export class MermaidCache {
  private map = new Map<string, string>();

  private static key(src: string, theme: MermaidTheme): string {
    return `${theme}:${src}`;
  }

  get(src: string, theme: MermaidTheme = "default"): string | undefined {
    const key = MermaidCache.key(src, theme);
    const svg = this.map.get(key);
    if (svg) {
      this.map.delete(key);
      this.map.set(key, svg);
    }
    return svg;
  }

  set(src: string, svg: string, theme: MermaidTheme = "default"): void {
    if (this.map.size >= MERMAID_CACHE_SIZE) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(MermaidCache.key(src, theme), svg);
  }

  clear(): void {
    this.map.clear();
  }
}

// Module-level singleton: one cache for every consumer, because a diagram
// rendered for the preview is the same diagram in the export.
let mermaidCache: MermaidCache | undefined;

export function getMermaidCache(): MermaidCache {
  mermaidCache ??= new MermaidCache();
  return mermaidCache;
}

export function clearMermaidCache(): void {
  mermaidCache?.clear();
  mermaidCache = undefined;
}

/**
 * Render one diagram, here on the main thread.
 *
 * Mermaid measures the text it lays out — `getBBox`, `getComputedTextLength` —
 * and sanitises its own output with DOMPurify, and neither works without a
 * real document. Inside a Web Worker with a shimmed DOM, the two failures
 * measured were `purify.addHook is not a function` and `Cannot read properties
 * of null (reading 'firstChild')`; even past those, the shim answered every
 * measurement with zero, so the diagram it produced would have been laid out
 * as though the text had no size.
 *
 * So this is where diagrams are drawn. It blocks the main thread while it
 * works, which is worth knowing and is what has always happened; moving it off
 * would mean giving Mermaid a real document somewhere else, not a shim.
 */
export async function renderMermaidMainThread(
  id: string,
  src: string,
  theme: MermaidTheme = "default",
): Promise<string> {
  const mermaidModule = await import("mermaid");
  const mermaid = mermaidModule.default;
  try {
    // Re-initialised every time rather than once: `initialize` is how the
    // theme is chosen, and this path has no idea which theme the last caller
    // asked for.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
      //
      // Ask Mermaid to draw labels as SVG `<text>` rather than as HTML inside
      // a `<foreignObject>`, which is its default.
      //
      // The preview hands every diagram to `sanitizeSvg` before it touches
      // the page, and that sanitizer removes blocked elements with their
      // contents — `foreignObject` is blocked on purpose, because an element
      // that carries arbitrary HTML is an element that could carry arbitrary
      // script, and a document's words come from wherever the document came
      // from. Under Mermaid's default, then, every diagram arrived as its
      // shapes and arrows with none of their label text: boxes with nothing
      // in them. Drawing the words as `<text>` keeps them on the side of the
      // security boundary that survives it, with the boundary itself intact.
      //
      // The root-level flag is what v11 reads for every diagram that has the
      // choice — flowchart, class, state, ER, block and the rest. The
      // `flowchart` one is its deprecated spelling, kept for the swimlane
      // clusters, which read it directly and treat a missing value as HTML.
      // What giving up the HTML labels costs is formatting inside a label:
      // a markdown string in backticks comes out as its plain text, not as
      // rich HTML — strictly better than coming out as nothing, which is
      // what it did. Math (`$$…$$`) needs the HTML path and stays invisible,
      // as it has always been here.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
  } catch {
    // Already initialized
  }
  const { svg } = await mermaid.render(id, src);
  return svg;
}
