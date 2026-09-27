/**
 * The zoom level of the whole window.
 *
 * One number, not a font size: what changes is how large everything is drawn,
 * from the text to the chrome around it, which is what people mean when they
 * reach for Ctrl+= — and what the webview's own zoom does on the desktop.
 * The editor's font size in Preferences is a separate idea and stays put.
 */

/**
 * The levels the shortcuts step through.
 *
 * A fixed ladder rather than a multiplier applied to whatever the level is
 * now, so that zooming in and back out always lands where it started, and so
 * the steps feel even: fine near 100%, where a page is read, and coarser at
 * the ends, where the difference between two levels has to be worth seeing.
 * The same shape browsers use.
 */
export const ZOOM_LEVELS = [
  0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

export const DEFAULT_ZOOM = 1;

const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

const ZOOM_STORAGE_KEY = "meditor.zoom.v1";

/** The level a stored number rounds to: nearest on the ladder, ends clamped. */
export function normalizeZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ZOOM;
  }
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  let best: number = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - clamped) < Math.abs(best - clamped)) best = level;
  }
  return best;
}

/**
 * The next level in `direction` (+1 up, −1 down) from where the zoom is now.
 *
 * The ends hold: zooming in at the largest level stays there, which is what
 * every program that has a ladder does and why pressing Ctrl+= too many times
 * needs no undoing.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const from = normalizeZoom(current);
  const index = ZOOM_LEVELS.indexOf(from as (typeof ZOOM_LEVELS)[number]);
  const next = index + direction;
  if (next < 0 || next >= ZOOM_LEVELS.length) return from;
  return ZOOM_LEVELS[next];
}

/** The remembered zoom, or the default where nothing valid is remembered. */
export function loadZoom(): number {
  if (typeof window === "undefined") return DEFAULT_ZOOM;
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw === null) return DEFAULT_ZOOM;
    return normalizeZoom(Number(raw));
  } catch {
    // Storage unavailable
    return DEFAULT_ZOOM;
  }
}

export function saveZoom(zoom: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    // Storage unavailable
  }
}
