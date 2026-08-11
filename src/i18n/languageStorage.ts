import type { Language } from "./translations";
import { LANGUAGES } from "./translations";

const LANG_STORAGE_KEY = "meditor.language.v1";

const ALL_LANGS = new Set<string>(LANGUAGES.map((l) => l.code));

/** Resolve the stored/browser language with safe fallbacks. Exported so the
 * ErrorBoundary (which lives outside the provider) can translate its fallback
 * UI without depending on React context. */
export function loadLanguage(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (raw && ALL_LANGS.has(raw)) return raw as Language;
  } catch {
    // Storage unavailable
  }
  // Detect browser language
  if (typeof navigator !== "undefined") {
    const nav = navigator.language?.slice(0, 2);
    if (nav && ALL_LANGS.has(nav)) return nav as Language;
  }
  return "en";
}

export function saveLanguage(lang: Language): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Storage unavailable
  }
}
