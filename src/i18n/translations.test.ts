import { describe, it, expect } from "vitest";
import { translations, LANGUAGES, isRtl, type TranslationKey, type Language } from "./translations";

const ALL_LANGUAGES: Language[] = LANGUAGES.map((l) => l.code);

function allKeys(): TranslationKey[] {
  return Object.keys(translations.en) as TranslationKey[];
}

function getValue(lang: Language, key: string): unknown {
  const dict = translations[lang] as Record<string, unknown>;
  return dict[key] ?? (translations.en as Record<string, unknown>)[key];
}

function valueType(lang: Language, key: TranslationKey): "string" | "function" {
  const v = getValue(lang, key);
  if (typeof v === "function") return "function";
  if (typeof v === "string") return "string";
  throw new Error(`Unexpected type for ${lang}.${key}: ${typeof v}`);
}

function countKeys(lang: Language): number {
  return Object.keys(translations[lang] as Record<string, unknown>).length;
}

describe("translations", () => {
  it("has exactly 104 languages", () => {
    expect(LANGUAGES).toHaveLength(104);
  });

  it("all language codes are unique", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(104);
  });

  it("English is the source of truth with all keys", () => {
    const enCount = countKeys("en");
    expect(enCount).toBeGreaterThan(100);
    // English should have the most keys (source of truth)
    for (const lang of ALL_LANGUAGES) {
      expect(countKeys(lang)).toBeLessThanOrEqual(enCount + 1);
    }
  });

  // ── Completeness: every EN key is defined (or has fallback via getValue) ──

  it("every English key resolves in all languages", () => {
    // getValue() falls back to English, so this asserts the runtime contract:
    // no key can ever resolve to undefined. It cannot detect a missing
    // translation — that is what the strict test below is for.
    for (const key of allKeys()) {
      for (const lang of ALL_LANGUAGES) {
        const v = getValue(lang, key);
        expect(
          v,
          `Key "${lang}.${key}" is missing with no fallback`,
        ).toBeDefined();
      }
    }
  });

  // ── Strict parity: every EN key is actually defined per language ──────

  /**
   * Keys that are knowingly not translated in every language yet. The runtime
   * falls back to English for these, so nothing breaks — but listing them
   * keeps the debt visible instead of letting a fallback hide it.
   *
   * Adding a key to English without translating it must fail the build; the
   * only way to silence that is to add it here on purpose.
   *
   * The full-parity pass translated every key into every language, so this
   * list is empty. Add to it only with a real reason, and drain it again.
   */
  const KNOWN_PARTIAL_KEYS = new Set<string>([]);

  it("every English key is defined in every language", () => {
    const missing: string[] = [];
    for (const key of allKeys()) {
      if (KNOWN_PARTIAL_KEYS.has(key)) continue;
      for (const lang of ALL_LANGUAGES) {
        const dict = translations[lang] as Record<string, unknown>;
        if (!(key in dict)) missing.push(`${lang}.${key}`);
      }
    }
    expect(
      missing,
      `translations missing (add the key, or list it in KNOWN_PARTIAL_KEYS):\n  ${missing.slice(0, 20).join("\n  ")}`,
    ).toEqual([]);
  });

  it("keys listed as partial really are still partial", () => {
    // Stops the exception list from going stale: once a key is translated
    // everywhere, it must be removed from KNOWN_PARTIAL_KEYS so it is guarded
    // by the strict test again.
    for (const key of KNOWN_PARTIAL_KEYS) {
      const absent = ALL_LANGUAGES.filter(
        (lang) => !(key in (translations[lang] as Record<string, unknown>)),
      );
      expect(
        absent.length,
        `"${key}" is now defined in all languages — remove it from KNOWN_PARTIAL_KEYS`,
      ).toBeGreaterThan(0);
    }
  });

  // ── Type consistency: function keys are functions in all langs that have them ──

  it("function keys in EN are also functions in languages that define them", () => {
    for (const key of allKeys()) {
      const enType = valueType("en", key);
      if (enType !== "function") continue;
      for (const lang of ALL_LANGUAGES) {
        const dict = translations[lang] as Record<string, unknown>;
        // Only check if the key is explicitly defined (not just fallback)
        if (key in dict) {
          const type = valueType(lang, key);
          expect(
            type,
            `Key "${key}" is function in EN but ${type} in ${lang.toUpperCase()}`,
          ).toBe("function");
        }
      }
    }
  });

  // ── No empty strings in defined values ─────────────────────────────

  it("no defined translation value is an empty string", () => {
    for (const lang of ALL_LANGUAGES) {
      const dict = translations[lang] as Record<string, unknown>;
      for (const key of Object.keys(dict)) {
        const v = dict[key];
        if (typeof v === "string") {
          expect(
            v.length,
            `Key "${lang}.${key}" is an empty string`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("does not expose the retired LaTeX placeholder notice", () => {
    for (const lang of ALL_LANGUAGES) {
      const dict = translations[lang] as Record<string, unknown>;
      const notice = dict["preview.latexNotice"];
      if (typeof notice === "string") {
        expect(notice, `${lang}.preview.latexNotice is obsolete`).not.toMatch(
          /coming soon|showing raw source/i,
        );
      }
    }
  });

  // ── verify shortcut keys ───────────────────────────────────────────

  it("shortcut keys exist in all 104 languages", () => {
    const shortcutKeys: TranslationKey[] = [
      "shortcuts.title", "shortcuts.close",
      "shortcuts.ctrlN", "shortcuts.ctrlO", "shortcuts.ctrlS",
      "shortcuts.find", "shortcuts.replace", "shortcuts.goToLine",
    ];
    for (const key of shortcutKeys) {
      for (const lang of ALL_LANGUAGES) {
        const v = getValue(lang, key);
        expect(v, `${key} missing in ${lang}`).toBeDefined();
        if (typeof v === "string") {
          expect(v.length, `${lang}.${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("error UI keys (ErrorBoundary) exist and are non-empty in all languages", () => {
    const errorKeys: TranslationKey[] = ["error.title", "error.retry"];
    for (const key of errorKeys) {
      for (const lang of ALL_LANGUAGES) {
        const v = getValue(lang, key);
        expect(v, `${key} missing in ${lang}`).toBeDefined();
        if (typeof v === "string") {
          expect(v.length, `${lang}.${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("outline keys exist and are non-empty in all languages", () => {
    const outlineKeys: TranslationKey[] = [
      "outline.label", "outline.toggle", "outline.empty",
    ];
    for (const key of outlineKeys) {
      for (const lang of ALL_LANGUAGES) {
        const v = getValue(lang, key);
        expect(v, `${key} missing in ${lang}`).toBeDefined();
        if (typeof v === "string") {
          expect(v.length, `${lang}.${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  // ── Content: a key defined in every language is not yet translated ──

  /*
   * The parity tests above prove presence; these prove translation. The
   * August expansion satisfied every structural check while leaving entire
   * clusters in English and word-by-word templates ("Empty or invalid
   * датотека path") in dozens of languages — a dictionary that speaks
   * English inside another language's sentence is not a translation, and
   * nothing keyed on keys alone ever caught it.
   */

  /** Key groups whose text is the same in every language by nature. */
  const UNIVERSAL_KEY_PREFIXES = ["shortcuts.ctrl", "menu.shortcut."];
  const UNIVERSAL_KEYS = new Set([
    "app.brand", // the product's own name
    "preview.mermaidError", // "Mermaid:" — a brand and a colon
    "preview.latexError", // "LaTeX:"
    "preview.typstError", // "Typst:"
    "editor.search.regexp", // CodeMirror's own word for the toggle
    "shortcuts.ctrlWheel",
  ]);
  /** English spellings that are also the local word (internationalisms). */
  const UNIVERSAL_VALUES = new Set([
    "Editor", "Document", "System", "Web", "Markdown", "Typst", "LaTeX",
    "Marp", "PDF", "Diagnostics", "OK", "A4", "US Letter",
  ]);
  /**
   * Single (language, key) pairs where the English spelling IS the local
   * word — a copy is the correct translation. Verified one by one; grow
   * this only the same way.
   */
  const LEGITIMATE_COPIES = new Set([
    "ca:doc.defaultExport", // "document" is Catalan
    "fr:doc.defaultExport", // …French
    "nl:doc.defaultExport", // …Dutch
    "ro:doc.defaultExport", // …Romanian
    "fr:preview.pages", // "pages" is French
    "sv:present.aria", // "Presentation" is Swedish
    "lb:editor.search.all", // "all" is Luxembourgish
  ]);

  it("leaves no translatable value in English", () => {
    const offenders: string[] = [];
    for (const key of allKeys()) {
      const en = (translations.en as Record<string, unknown>)[key];
      if (typeof en !== "string") continue;
      if (UNIVERSAL_KEYS.has(key)) continue;
      if (UNIVERSAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      if (UNIVERSAL_VALUES.has(en)) continue;
      if (!/[a-zA-Z]{3}/.test(en)) continue; // nothing to translate in it
      for (const lang of ALL_LANGUAGES) {
        if (lang === "en") continue;
        const v = (translations[lang] as Record<string, unknown>)[key];
        if (v !== en) continue;
        if (LEGITIMATE_COPIES.has(`${lang}:${key}`)) continue;
        offenders.push(`${lang}.${key}`);
      }
    }
    expect(
      offenders,
      "still spelled in English — translate them; a copy is only legitimate " +
        "when the English word is the local word, and then it belongs in " +
        `LEGITIMATE_COPIES:\n  ${offenders.slice(0, 20).join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * Word pairs only English says, lifted from the messages the template
   * batch half-translated. A value that is not the English one but still
   * contains one of these is English furniture inside a translated sentence.
   */
  const ENGLISH_FINGERPRINTS = new Set([
    "is no", "no longer", "could not", "went wrong", "does not", "has no",
    "points to", "exceeds allowed", "empty or invalid", "available for",
    "for saving", "start writing", "close all", "close other", "next tab",
    "previous tab", "source code", "resize panels", "follow system",
    "or invalid", "to a directory", "parent folder", "allowed limit",
    "something went",
  ]);

  it("has no value half in English and half in its own language", () => {
    const offenders: string[] = [];
    for (const key of allKeys()) {
      const en = (translations.en as Record<string, unknown>)[key];
      if (typeof en !== "string") continue;
      for (const lang of ALL_LANGUAGES) {
        if (lang === "en") continue;
        const v = (translations[lang] as Record<string, unknown>)[key];
        if (typeof v !== "string" || v === en) continue;
        const words = v.toLowerCase().match(/[a-z']+/g) ?? [];
        for (let i = 0; i + 1 < words.length; i++) {
          if (ENGLISH_FINGERPRINTS.has(`${words[i]} ${words[i + 1]}`)) {
            offenders.push(`${lang}.${key}: "${v}"`);
            break;
          }
        }
      }
    }
    expect(
      offenders,
      `English islands inside translated values:\n  ${offenders.slice(0, 10).join("\n  ")}`,
    ).toEqual([]);
  });

  it("translates the plural functions too, except pure units", () => {
    // A function's body is where the August batch left English plurals
    // ("${n} word${…}") in the four Amazigh languages while the strings
    // around them were translated. Checked for those four, where the debt
    // was; a language that spells a body like the English one may simply
    // share the word ("Version ${v}" is correct German). Units are the
    // exception everywhere: "mm" and "px" are the same in every language.
    const UNITS = new Set(["prefs.pageMarginValue", "prefs.pixels"]);
    const AMAZIGH: Language[] = ["kab", "rif", "shi", "zgh"];
    const normalize = (f: unknown) =>
      String(f).replace(/\s+/g, " ").replace(/^\(.*?\)\s*=>\s*/, "");
    const offenders: string[] = [];
    for (const key of allKeys()) {
      const en = (translations.en as Record<string, unknown>)[key];
      if (typeof en !== "function" || UNITS.has(key)) continue;
      for (const lang of AMAZIGH) {
        const v = (translations[lang] as Record<string, unknown>)[key];
        if (typeof v !== "function") continue;
        if (normalize(v) === normalize(en)) offenders.push(`${lang}.${key}`);
      }
    }
    expect(
      offenders,
      `function bodies still in English:\n  ${offenders.slice(0, 10).join("\n  ")}`,
    ).toEqual([]);
  });

  // ── Language metadata ──────────────────────────────────────────────

  it("LANGUAGES entries match translations object", () => {
    const transCodes = Object.keys(translations).sort();
    const langCodes = LANGUAGES.map((l) => l.code).sort();
    expect(langCodes).toEqual(transCodes);
  });

  it("each language has a nativeLabel", () => {
    for (const lang of LANGUAGES) {
      expect(lang.nativeLabel.length).toBeGreaterThan(0);
      expect(lang.label.length).toBeGreaterThan(0);
      expect(lang.code.length).toBeGreaterThanOrEqual(2);
    }
  });

  // ── Text direction ─────────────────────────────────────────────────

  it("RTL languages are exactly ar, fa, he, ps, sd and ur", () => {
    const rtl = ALL_LANGUAGES.filter((l) => isRtl(l));
    expect(rtl.sort()).toEqual(["ar","fa","he","ps","sd","ur"]);
  });

  it("all other languages are LTR", () => {
    const rtl = new Set(["ar","ur","fa","he","ps","sd"]);
    for (const lang of ALL_LANGUAGES) {
      if (rtl.has(lang)) continue;
      expect(isRtl(lang), `${lang} should be LTR`).toBe(false);
    }
  });
});
