// @vitest-environment node
import { describe, it, expect } from "vitest";
import indexHtml from "../../index.html?raw";
import { LANGUAGES, isRtl } from "./translations";

/**
 * The anti-FOUC script in index.html has to duplicate the language resolution
 * of languageStorage.ts, because it runs before any module loads. These tests
 * execute that inline script against a stubbed DOM and assert its behaviour, so
 * the duplicate cannot drift from the real language table again — it had: the
 * guard shipped 64 of the 104 codes and rejected every three-letter code, which
 * silently dropped `dir="rtl"` for Pashto and Sindhi on the first paint.
 */

/** The inline script (the other <script> is the module entry point). */
const guardSource = (() => {
  const match = /<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  if (!match) throw new Error("inline anti-FOUC script not found in index.html");
  return match[1];
})();

type GuardInput = {
  stored?: string | null;
  navigatorLanguage?: string;
  preferences?: unknown;
  throwOnStorage?: boolean;
};

type GuardResult = { lang: string; dir: string; theme?: string };

/** Run the anti-FOUC script against a stubbed document and return what it set. */
function runGuard({
  stored = null,
  navigatorLanguage = "en-US",
  preferences = null,
  throwOnStorage = false,
}: GuardInput = {}): GuardResult {
  const documentElement = {
    lang: "",
    dir: "",
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const localStorage = {
    getItem(key: string): string | null {
      if (throwOnStorage) throw new Error("storage unavailable");
      if (key === "meditor.language.v1") return stored;
      if (key === "meditor.preferences.v1") {
        return preferences === null ? null : JSON.stringify(preferences);
      }
      return null;
    },
  };
  // The parameters shadow the real globals inside the script's scope.
  const run = new Function("document", "navigator", "localStorage", guardSource);
  run({ documentElement }, { language: navigatorLanguage }, localStorage);
  return {
    lang: documentElement.lang,
    dir: documentElement.dir,
    theme: documentElement.dataset.theme,
  };
}

const ALL_CODES = LANGUAGES.map((l) => l.code);

describe("index.html anti-FOUC language guard", () => {
  it("applies every language the app ships", () => {
    const rejected = ALL_CODES.filter(
      (code) => runGuard({ stored: code }).lang !== code,
    );
    expect(rejected, `codes not honoured by index.html: ${rejected.join(", ")}`)
      .toEqual([]);
  });

  it("sets dir=rtl for every right-to-left language", () => {
    const missing = ALL_CODES.filter(isRtl).filter(
      (code) => runGuard({ stored: code }).dir !== "rtl",
    );
    expect(missing, `RTL languages without dir=rtl: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("leaves left-to-right languages untouched", () => {
    for (const code of ["en", "es", "zh", "fil", "rif"]) {
      expect(runGuard({ stored: code }).dir).not.toBe("rtl");
    }
  });

  it("honours three-letter codes stored by the app", () => {
    // languageStorage.ts persists these verbatim; a two-letter guard drops them.
    for (const code of ALL_CODES.filter((c) => c.length === 3)) {
      expect(runGuard({ stored: code }).lang).toBe(code);
    }
  });

  it("falls back to the browser's primary subtag", () => {
    expect(runGuard({ navigatorLanguage: "es-ES" }).lang).toBe("es");
    expect(runGuard({ navigatorLanguage: "ar-EG" }).dir).toBe("rtl");
    // "fil-PH".slice(0, 2) would resolve to Finnish instead of Filipino.
    expect(runGuard({ navigatorLanguage: "fil-PH" }).lang).toBe("fil");
    expect(runGuard({ navigatorLanguage: "FR-ca" }).lang).toBe("fr");
  });

  it("prefers the stored language over the browser's", () => {
    expect(runGuard({ stored: "ja", navigatorLanguage: "de-DE" }).lang).toBe("ja");
  });

  it("ignores languages it does not ship", () => {
    const unknownBrowser = "xx-YY";
    expect(runGuard({ stored: "xx", navigatorLanguage: unknownBrowser }).lang).toBe("");
    // A bare prefix must not match a shipped code ("e" is not "en").
    expect(runGuard({ stored: "e", navigatorLanguage: unknownBrowser }).lang).toBe("");
    expect(runGuard({ navigatorLanguage: unknownBrowser }).lang).toBe("");
  });

  it("falls back to the browser when the stored language is unknown", () => {
    expect(runGuard({ stored: "xx", navigatorLanguage: "de-DE" }).lang).toBe("de");
  });

  it("survives unavailable storage", () => {
    expect(() => runGuard({ throwOnStorage: true })).not.toThrow();
  });

  it("still applies the saved theme", () => {
    // The language fix must not disturb the theme half of the same script.
    expect(runGuard({ preferences: { theme: "dark" } }).theme).toBe("dark");
    expect(runGuard({ preferences: { theme: "contrast" } }).theme).toBe("contrast");
  });
});
