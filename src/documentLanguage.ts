import { LANGUAGES } from "./i18n/translations";

/** The language a document declares, and the direction its script runs in. */
export type DocumentLanguage = { tag: string; dir: "ltr" | "rtl" };

/*
 * Scripts written right to left, by their ISO 15924 code. The interface's own
 * list of right-to-left languages (translations/index.ts) holds only the six
 * it is translated into; a document can be in any language, so the direction
 * comes from the script the language is written in instead.
 */
const RIGHT_TO_LEFT_SCRIPTS = new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

const INTERFACE_LANGUAGES = new Set<string>(LANGUAGES.map((language) => language.code));

/**
 * The language a document says it is written in: `lang:` in its front-matter,
 * as Pandoc spells it. Null when it says nothing, or something that is not a
 * language — "inglés", "english" — so the document keeps following the
 * interface, as it always has.
 *
 * The tag is canonicalised (`es_es` becomes `es-ES`), and its direction comes
 * from the script the language is usually written in, so `ar`, `ur`, `sd`,
 * `ckb` or `pa-Arab` read right to left and `pa` does not.
 */
export function documentLanguage(value: string | null | undefined): DocumentLanguage | null {
  const raw = (value ?? "").trim().replace(/_/g, "-");
  if (!raw) return null;
  let tag: string | undefined;
  try {
    [tag] = Intl.getCanonicalLocales(raw);
  } catch {
    return null;
  }
  if (!tag || !isLanguage(tag)) return null;
  return { tag, dir: directionOf(tag) };
}

/**
 * Whether the tag names a language anybody knows. Well-formed is not enough:
 * BCP 47 allows five to eight letters as a primary subtag, so "english" is a
 * valid tag for a language that does not exist.
 */
function isLanguage(tag: string): boolean {
  const language = tag.split("-")[0];
  if (INTERFACE_LANGUAGES.has(language)) return true;
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
    return names.of(language) !== undefined;
  } catch {
    return false;
  }
}

function directionOf(tag: string): "ltr" | "rtl" {
  try {
    const script = new Intl.Locale(tag).maximize().script;
    return script && RIGHT_TO_LEFT_SCRIPTS.has(script) ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}
