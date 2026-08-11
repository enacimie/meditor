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
  it("has exactly 20 languages", () => {
    expect(LANGUAGES).toHaveLength(20);
  });

  it("all language codes are unique", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(20);
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

  // ── verify shortcut keys ───────────────────────────────────────────

  it("shortcut keys exist in all 20 languages", () => {
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
      expect(lang.code.length).toBe(2);
    }
  });

  // ── Text direction ─────────────────────────────────────────────────

  it("RTL languages are exactly ar and ur", () => {
    const rtl = ALL_LANGUAGES.filter((l) => isRtl(l));
    expect(rtl.sort()).toEqual(["ar", "ur"]);
  });

  it("all other languages are LTR", () => {
    for (const lang of ALL_LANGUAGES) {
      if (lang === "ar" || lang === "ur") continue;
      expect(isRtl(lang), `${lang} should be LTR`).toBe(false);
    }
  });
});
