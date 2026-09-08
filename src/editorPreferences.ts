import { PAPERS, type PaperId } from "./pageSetup";

/**
 * Editor appearance preferences.
 *
 * Kept apart from App's Preferences type so both the dialog and the CodeMirror
 * setup can share the validation without importing each other.
 */

export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 24;
export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const DEFAULT_EDITOR_FONT_FAMILY = "system";

export const DEFAULT_SPELLCHECK = true;

/**
 * Wide tables in the Document view: shrink first (previewRenderer.ts), and
 * only if no portrait step fits, offer a sideways page. Off by default — a
 * page turning landscape on its own is a surprise the reader should ask for.
 */
export const DEFAULT_LANDSCAPE_TABLES = false;

/** A4, which is what the project has always laid out on. */
export const DEFAULT_PAPER_SIZE: PaperId = "a4";

/** Off. See the field’s comment for why that is a decision. */
export const DEFAULT_AUTOSAVE = false;

/**
 * Writing aids, both off unless asked for.
 *
 * Dimming the page and moving it under the caret are strong opinions about
 * how someone writes: welcome to the people who want them, and an editor
 * behaving oddly to everyone else.
 */
export const DEFAULT_FOCUS_MODE = false;
export const DEFAULT_TYPEWRITER_MODE = false;

export type EditorPreferences = {
  editorFontSize: number;
  editorFontFamily: string;
  /** Hand the text to the platform's own spell checker. */
  spellcheck: boolean;
  /** Let a table too wide for any portrait page use a landscape one. */
  landscapeTables: boolean;
  /** Dim everything but the paragraph being written. */
  focusMode: boolean;
  /** Keep the line being written in the middle of the pane. */
  typewriterMode: boolean;
  /**
   * The sheet the Document view lays out on, and prints to.
   *
   * A preference and not a per-document setting, for now: it is the paper in
   * the printer, which does not change between documents as often as it
   * changes between people.
   */
  paperSize: PaperId;
  /**
   * Write a document to its file on its own, shortly after the typing stops.
   *
   * Off by default, and that is the decision rather than an oversight. This
   * editor’s model is an explicit save with a session that remembers the
   * unsaved work, and turning that around for everyone would change what
   * Ctrl+S means to people who already rely on it.
   */
  autosave: boolean;
};

/**
 * Font choices offered for the editor. Only font stacks that resolve to fonts
 * already present on the system — meditor does not ship extra editor fonts, so
 * every entry degrades to the generic family at the end of its stack.
 */
export const EDITOR_FONT_FAMILIES: Array<{
  id: string;
  label: string;
  stack: string;
}> = [
  {
    id: "system",
    // Rendered through t("prefs.fontSystem"); the label is the fallback.
    label: "System monospace",
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  },
  {
    id: "fira",
    label: "Fira Code",
    stack: '"Fira Code", ui-monospace, Consolas, monospace',
  },
  {
    id: "cascadia",
    label: "Cascadia Code",
    stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, Consolas, monospace',
  },
  {
    id: "ibm-plex",
    label: "IBM Plex Mono",
    stack: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
  },
  {
    id: "serif",
    label: "Serif",
    stack: 'Georgia, "Times New Roman", serif',
  },
];

/** CSS font stack for a stored family id, falling back to the system one. */
export function fontStackFor(id: string): string {
  const found = EDITOR_FONT_FAMILIES.find((font) => font.id === id);
  return (found ?? EDITOR_FONT_FAMILIES[0]).stack;
}

/** Clamp a stored font size into the range the dialog offers. */
export function clampFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(value)));
}

/** Read a stored boolean, falling back to the default. */
export function normalizeSpellcheck(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SPELLCHECK;
}

/** Read a stored boolean, falling back to the default. */
export function normalizeLandscapeTables(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_LANDSCAPE_TABLES;
}

/** A stored autosave flag, or off for anything that is not a boolean. */
export function normalizeAutosave(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_AUTOSAVE;
}

/** A stored paper id, or A4 for anything this build does not know. */
export function normalizePaperSize(value: unknown): PaperId {
  return typeof value === "string" && value in PAPERS ? (value as PaperId) : DEFAULT_PAPER_SIZE;
}

/** Read a stored boolean, falling back to the default. */
export function normalizeFocusMode(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_FOCUS_MODE;
}

/** Read a stored boolean, falling back to the default. */
export function normalizeTypewriterMode(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_TYPEWRITER_MODE;
}

/** Accept a stored family id only if it is still offered. */
export function normalizeFontFamily(value: unknown): string {
  return typeof value === "string" &&
    EDITOR_FONT_FAMILIES.some((font) => font.id === value)
    ? value
    : DEFAULT_EDITOR_FONT_FAMILY;
}
