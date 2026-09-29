/**
 * The editor and preview preferences: what they are, what they start as, and
 * how they are read back from storage and written to it.
 *
 * Moved out of App.tsx unchanged. App still reads them once, at module load
 * (`INITIAL_PREFERENCES`), which is when the tests expect them read.
 */
import type { LayoutMode, Theme } from "./components/types";
import { prefersCoarsePointer } from "./hooks/useCoarsePointer";
import {
  clampFontSize,
  normalizeFontFamily,
  normalizeSpellcheck,
  normalizeFocusMode,
  normalizeLandscapeTables,
  normalizeTypewriterMode,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_SPELLCHECK,
  DEFAULT_FOCUS_MODE,
  DEFAULT_LANDSCAPE_TABLES,
  DEFAULT_TYPEWRITER_MODE,
  DEFAULT_EDITOR_FONT_SIZE,
  type EditorPreferences,
  DEFAULT_PAPER_SIZE,
  DEFAULT_AUTOSAVE,
  DEFAULT_PAGE_MARGIN_MM,
  normalizePaperSize,
  normalizeAutosave,
  normalizePageMargin,
} from "./editorPreferences";

// Editor/preview preferences. The interface language is NOT part of this
// object: I18nProvider owns it (meditor.language.v1, validated against the
// languages that exist) so there is a single source of truth for the locale.
export type Preferences = {
  docView: boolean;
  wrap: boolean;
  theme: Theme;
  layoutMode: LayoutMode;
} & EditorPreferences;

const PREFERENCES_KEY = "meditor.preferences.v1";
const DEFAULT_PREFERENCES: Preferences = {
  docView: true,
  wrap: true,
  theme: "system",
  layoutMode: "split",
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
  spellcheck: DEFAULT_SPELLCHECK,
  landscapeTables: DEFAULT_LANDSCAPE_TABLES,
  focusMode: DEFAULT_FOCUS_MODE,
  typewriterMode: DEFAULT_TYPEWRITER_MODE,
  paperSize: DEFAULT_PAPER_SIZE,
  autosave: DEFAULT_AUTOSAVE,
  pageMarginMm: DEFAULT_PAGE_MARGIN_MM,
};
/**
 * Whether a first run should open in the paginated A4 view.
 *
 * On a desktop, yes — it is the nicer way to read a document. On a phone it is
 * the wrong answer twice over: an A4 page is 794px wide and a phone is not, so
 * it arrives either shrunk past legibility or needing sideways scrolling to
 * read a line. Only the default moves; a choice made explicitly, on either
 * kind of device, is what gets stored and what comes back.
 */
function defaultDocView(): boolean {
  return !prefersCoarsePointer();
}

export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES, docView: defaultDocView() };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
    const stored = value as Partial<Preferences>;
    const theme =
      stored.theme === "light" ||
      stored.theme === "dark" ||
      stored.theme === "system" ||
      stored.theme === "contrast"
        ? stored.theme
        : DEFAULT_PREFERENCES.theme;
    const layoutMode =
      stored.layoutMode === "editor" ||
      stored.layoutMode === "split" ||
      stored.layoutMode === "preview"
        ? stored.layoutMode
        : DEFAULT_PREFERENCES.layoutMode;
    return {
      docView: typeof stored.docView === "boolean" ? stored.docView : defaultDocView(),
      wrap: typeof stored.wrap === "boolean" ? stored.wrap : DEFAULT_PREFERENCES.wrap,
      theme,
      layoutMode,
      // Clamped/whitelisted: a stale or hand-edited value must not break the
      // editor, only fall back to the default.
      editorFontSize: clampFontSize(stored.editorFontSize),
      editorFontFamily: normalizeFontFamily(stored.editorFontFamily),
      spellcheck: normalizeSpellcheck(stored.spellcheck),
      landscapeTables: normalizeLandscapeTables(stored.landscapeTables),
      focusMode: normalizeFocusMode(stored.focusMode),
      typewriterMode: normalizeTypewriterMode(stored.typewriterMode),
      paperSize: normalizePaperSize(stored.paperSize),
      autosave: normalizeAutosave(stored.autosave),
      pageMarginMm: normalizePageMargin(stored.pageMarginMm),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be disabled or unavailable in a WebView.
  }
}
