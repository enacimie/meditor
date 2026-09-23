import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";
import { DEFAULT_QUOTES, quotesFor } from "./documentQuotes";

const NNBSP = "\u202F";

/** The rendered paragraph of a document in `lang`, or without front-matter. */
function quoted(text: string, lang?: string): string {
  const source = lang === undefined ? `${text}\n` : `---\nlang: ${lang}\n---\n\n${text}\n`;
  const html = renderMarkdown(source);
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/.exec(html);
  if (!paragraph) throw new Error(`no paragraph in ${html}`);
  return paragraph[1];
}

describe("quotation marks in the document's language", () => {
  it("keeps the marks it always had when the document declares no language", () => {
    expect(quoted(`"Said: 'hi'"`)).toBe("“Said: ‘hi’”");
  });

  it("sets Spanish with « » outside and “ ” inside, as the RAE recommends", () => {
    expect(quoted(`"Dijo: 'hola'"`, "es")).toBe("«Dijo: “hola”»");
    expect(quoted(`"Dijo: 'hola'"`, "es-MX")).toBe("«Dijo: “hola”»");
  });

  it("puts a narrow no-break space inside French marks", () => {
    expect(quoted(`"Il a dit : 'bonjour'"`, "fr")).toBe(
      `«${NNBSP}Il a dit : «${NNBSP}bonjour${NNBSP}»${NNBSP}»`,
    );
    // Canadian French takes CLDR's inner marks, which have no space.
    expect(quoted(`"Il a dit : 'bonjour'"`, "fr-CA")).toBe(
      `«${NNBSP}Il a dit : ”bonjour“${NNBSP}»`,
    );
  });

  it("takes other languages' marks from CLDR", () => {
    expect(quoted(`"Er sagte: 'hallo'"`, "de")).toBe("„Er sagte: ‚hallo‘“");
    expect(quoted(`"Powiedział: 'cześć'"`, "pl")).toBe("„Powiedział: «cześć»”");
    expect(quoted(`"言った 'はい'"`, "ja")).toBe("「言った 『はい』」");
  });

  it("goes back to the default for the next document that declares none", () => {
    // markdown-it reads the marks from options shared by every render: one
    // in Spanish must not leave its « » behind for the next document.
    expect(quoted(`"hola"`, "es")).toBe("«hola»");
    expect(quoted(`"hello"`)).toBe("“hello”");
  });

  it("keeps the default when what is declared is not a language", () => {
    expect(quoted(`"hello"`, "inglés")).toBe("“hello”");
  });
});

describe("quotesFor", () => {
  const joined = (tag: string | null) => quotesFor(tag).join("");

  it("finds a regional form before its language", () => {
    expect(joined("pt")).toBe(DEFAULT_QUOTES.join(""));
    expect(joined("pt-BR")).toBe(DEFAULT_QUOTES.join(""));
    expect(joined("pt-PT")).toBe("«»“”");
  });

  it("follows CLDR's parents: Portuguese outside Brazil, and Chinese by its script", () => {
    expect(joined("pt-AO")).toBe("«»“”");
    expect(joined("zh-TW")).toBe("「」『』");
    expect(joined("zh")).toBe(DEFAULT_QUOTES.join(""));
  });

  it("falls back to the language for a region with nothing of its own", () => {
    expect(joined("de-AT")).toBe("„“‚‘");
    expect(joined("nb")).toBe("«»‘’");
  });

  it("gives the default for no language at all", () => {
    expect(quotesFor(null)).toBe(DEFAULT_QUOTES);
    expect(quotesFor(undefined)).toBe(DEFAULT_QUOTES);
  });
});
