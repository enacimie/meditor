import type MarkdownIt from "markdown-it";
import { documentLanguage } from "./documentLanguage";
import { frontMatterValue } from "./frontMatter";

/**
 * Quotation marks in the language the document is written in.
 *
 * `"…"` and `'…'` in the source become the outer and the inner marks of the
 * language the front-matter declares (`lang:`, see documentLanguage.ts). A
 * document that declares none gets the marks it has always had, whatever the
 * interface is in: the same file prints the same for whoever opens it.
 */

/** Outer opening and closing mark, then inner, in the order markdown-it takes them. */
export type Quotes = readonly [string, string, string, string];

/** The renderer's marks before languages had their own, and still the default. */
export const DEFAULT_QUOTES: Quotes = ["“", "”", "‘", "’"];

/** Narrow no-break space: French sets it inside « », and a line never breaks there. */
const NNBSP = "\u202F";

/*
 * From CLDR (cldr-json, `delimiters`): the languages the interface is
 * translated into whose marks are not English ones, the two written forms of
 * Norwegian, and the regional forms whose marks are not their language's.
 * Two entries are not CLDR's, by decision:
 *
 * - Spanish takes « » and “ ” inside, as the RAE recommends for printed text
 *   (Diccionario panhispánico de dudas, "comillas"). CLDR has “ ” and ‘ ’.
 * - French sets a narrow no-break space inside « » and ‹ ›. CLDR has the
 *   marks, and says nothing of the spacing.
 *
 * Left out: CLDR's Southern Sotho (`st`) closes its outer quotation with ’,
 * which looks like an error in the data, so it keeps the default.
 */
const QUOTES: Record<string, string | Quotes> = {
  am: "«»‹›",
  ar: "”“’‘",
  be: "«»„“",
  bg: "„“„“",
  bs: "„”‘’",
  ca: "«»“”",
  cs: "„“‚‘",
  de: "„“‚‘",
  el: "«»“”",
  es: "«»“”",
  et: "„“‚‘",
  eu: "«»“”",
  fa: "«»‹›",
  fi: "””’’",
  fr: [`«${NNBSP}`, `${NNBSP}»`, `«${NNBSP}`, `${NNBSP}»`],
  "fr-CA": [`«${NNBSP}`, `${NNBSP}»`, "”", "“"],
  "fr-CH": [`«${NNBSP}`, `${NNBSP}»`, `‹${NNBSP}`, `${NNBSP}›`],
  he: "””’’",
  hr: "„“‚‘",
  ht: "«»«»",
  hu: "„”»«",
  hy: "«»«»",
  is: "„“‚‘",
  it: "«»“”",
  ja: "「」『』",
  ka: "„“«»",
  kab: "«»“”",
  kk: "«»“”",
  ky: "«»„“",
  lb: "„“‚‘",
  lt: "„“„“",
  mg: "«»“”",
  mk: "„“‚‘",
  // Norwegian as the interface names it, and its two written standards.
  nb: "«»‘’",
  nl: "‘’‘’",
  nn: "«»‘’",
  no: "«»‘’",
  pl: "„”«»",
  "pt-PT": "«»“”",
  ro: "„”«»",
  ru: "«»„“",
  shi: "«»„”",
  sk: "„“‚‘",
  sl: "„“‚‘",
  sr: "„”’’",
  sv: "””’’",
  tk: "“”“”",
  uk: "«»„“",
  ur: "”“’‘",
  uz: "“”’‘",
  zgh: "«»„”",
  "zh-Hant": "「」『』",
};

/**
 * Portuguese outside Brazil. CLDR makes these regions children of `pt-PT`
 * (`parentLocales`), so they take its marks rather than those of `pt`.
 */
const EUROPEAN_PORTUGUESE_REGIONS = new Set(["AO", "CH", "CV", "FR", "GQ", "GW", "LU", "MO", "MZ", "ST", "TL"]);

/** The marks for a declared language, or the default when it declares none. */
export function quotesFor(declared: string | null | undefined): Quotes {
  const language = documentLanguage(declared);
  if (!language) return DEFAULT_QUOTES;
  for (const candidate of lookupOrder(language.tag)) {
    const found = QUOTES[candidate];
    if (found) return typeof found === "string" ? (Array.from(found) as unknown as Quotes) : found;
  }
  return DEFAULT_QUOTES;
}

/**
 * Most specific first: the language with its region, with its script, then
 * alone. `zh-TW` finds `zh-Hant`, and `pt-AO` finds `pt-PT`.
 */
function lookupOrder(tag: string): string[] {
  const order: string[] = [];
  try {
    const { language, script, region } = new Intl.Locale(tag).maximize();
    if (region) order.push(`${language}-${region}`);
    if (language === "pt" && region && EUROPEAN_PORTUGUESE_REGIONS.has(region)) order.push("pt-PT");
    if (script) order.push(`${language}-${script}`);
    order.push(language);
  } catch {
    order.push(tag.split("-")[0]);
  }
  return order;
}

/**
 * A markdown-it plugin that sets the marks for each render, before
 * `smartquotes` reads them.
 *
 * markdown-it reads the marks from its options as it goes, so they are set on
 * the shared instance, every time: a render runs to completion before the
 * next one starts, and a document without `lang:` puts the default back
 * rather than inheriting the last document's.
 */
export function documentQuotes(md: MarkdownIt): void {
  md.core.ruler.before("smartquotes", "document_quotes", (state) => {
    const frontMatter = state.env?.frontMatter;
    const declared = typeof frontMatter === "string" ? frontMatterValue(frontMatter, "lang") : null;
    state.md.options.quotes = [...quotesFor(declared)];
  });
}
