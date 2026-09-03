/**
 * Presentation directives for Marp decks: slide transitions.
 *
 * Marp Bespoke — the runtime Marp CLI injects into its standalone HTML export —
 * animates slide changes from a `transition` local directive using the View
 * Transitions API. meditor's presenter reproduces that behaviour here, parsing
 * the directive from the Markdown source so it knows how each slide should
 * enter.
 *
 * Directives:
 *   front-matter `transition: fade`        -> default for every slide
 *   `<!-- transition: wipe 0.6s -->`        -> how the enclosing slide enters
 *
 * Fragment steps (elements that reveal one at a time) are Marpit-native: the
 * items of `*` and `)` lists are marked with `data-marpit-fragment` at render
 * time, exactly the steps Marp Bespoke paces through. The presenter reads those
 * attributes directly, and additionally honours the `fragment` / `fragment-list`
 * classes to opt arbitrary elements in.
 */
import { slideStartLines } from "./marpSlides";

export const TRANSITION_TYPES = [
  "fade",
  "slide",
  "smooth",
  "wipe",
  "zoom",
  "iris",
  "drip",
  "pull",
  "cover",
] as const;

const KNOWN_TRANSITIONS = new Set<string>(TRANSITION_TYPES);

/** How a slide enters, parsed and normalised. */
export type SlidePresent = {
  /** Transition used when navigating into the slide (`"none"` = instant). */
  transition: string;
  /** Duration if the directive carried one (e.g. `"0.6s"`), else null. */
  duration: string | null;
};

function strip(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Read a top-level front-matter value. Keys must start at column zero so that
 * lines inside a block scalar (e.g. a `style: |` CSS payload that mentions
 * `transition:`) are never mistaken for directives.
 */
export function frontmatterValue(content: string, key: string): string | null {
  const lines = strip(content).split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") return null;
  const re = new RegExp(`^${key}[ \\t]*:[ \\t]+(.+)$`, "i");
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") break;
    const m = lines[i].match(re);
    if (!m) continue;
    const value = m[1]
      .replace(/\s*#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    return value || null;
  }
  return null;
}

/** Split the deck into one source chunk per slide, aligned with the render. */
function slideChunks(content: string): string[] {
  const src = strip(content);
  const lines = src.split(/\r?\n/);
  const starts = slideStartLines(content);
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    return lines.slice(start, end).join("\n");
  });
}

const TRANSITION_COMMENT = /<!--\s*_?transition\s*:\s*([^>]*?)\s*-->/i;
const TIME = /^\d+(?:\.\d+)?(?:ms|s)$/;

/** The presenter's own default is a visible fade; Marp's default is instant. */
export const DEFAULT_TRANSITION = "fade";

function parseTransitionValue(raw: string | null): { type: string; duration: string | null } {
  if (!raw) return { type: DEFAULT_TRANSITION, duration: null };
  const tokens = raw.trim().split(/\s+/);
  const head = tokens[0].toLowerCase();
  let type: string;
  if (head === "none") type = "none";
  else if (KNOWN_TRANSITIONS.has(head)) type = head;
  else type = DEFAULT_TRANSITION;
  const duration = tokens[1] && TIME.test(tokens[1]) ? tokens[1] : null;
  return { type, duration };
}

/** Parse per-slide presentation directives, aligned with the rendered slides. */
export function parseSlidePresents(content: string): SlidePresent[] {
  const globalTransition = frontmatterValue(content, "transition");
  return slideChunks(content).map((chunk) => {
    const local = chunk.match(TRANSITION_COMMENT);
    const { type, duration } = parseTransitionValue(local ? local[1] : globalTransition);
    return { transition: type, duration };
  });
}
