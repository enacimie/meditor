import { describe, it, expect, vi } from "vitest";
import { documentLanguage } from "./documentLanguage";

describe("documentLanguage", () => {
  it("takes a language tag, tidied into its canonical form", () => {
    expect(documentLanguage("es")).toEqual({ tag: "es", dir: "ltr" });
    expect(documentLanguage("es_es")).toEqual({ tag: "es-ES", dir: "ltr" });
    expect(documentLanguage(" EN-us ")).toEqual({ tag: "en-US", dir: "ltr" });
  });

  it("reads right to left when the language's script does", () => {
    for (const tag of ["ar", "he", "fa", "ur"]) {
      expect(documentLanguage(tag)?.dir, tag).toBe("rtl");
    }
  });

  it("knows the direction of languages the interface is not translated into", () => {
    // The interface's own list has six right-to-left languages; none of these
    // is in it, and only the script says which way they run.
    for (const tag of ["ckb", "pa-PK", "ug", "yi", "dv"]) {
      expect(documentLanguage(tag)?.dir, tag).toBe("rtl");
    }
    // Punjabi is written in Gurmukhi in India and in Arabic in Pakistan.
    expect(documentLanguage("pa")?.dir).toBe("ltr");
    expect(documentLanguage("zgh")?.dir).toBe("ltr");
  });

  it("accepts the interface's own languages where the platform names none", () => {
    // A webview whose Intl knows no language names: what the interface is
    // translated into is still a language, and anything else still is not.
    const names = vi.spyOn(Intl, "DisplayNames").mockImplementation(
      class {
        of() {
          return undefined;
        }
      } as unknown as typeof Intl.DisplayNames,
    );
    try {
      expect(documentLanguage("rif")?.tag).toBe("rif");
      expect(documentLanguage("es-ES")?.tag).toBe("es-ES");
      expect(documentLanguage("english")).toBeNull();
    } finally {
      names.mockRestore();
    }
  });

  it("ignores what is not a language, so the interface's still applies", () => {
    for (const value of ["inglés", "english", "12", "", "  ", null, undefined]) {
      expect(documentLanguage(value), String(value)).toBeNull();
    }
  });
});
