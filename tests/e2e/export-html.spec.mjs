/**
 * E2E spec — the exported HTML is really self-contained.
 *
 * This has to run in a browser: the export fetches KaTeX's stylesheet from the
 * asset the bundler emits for it, and unit tests cannot see that (vitest does
 * not process CSS, so the import resolves to an empty string).
 *
 * What is checked is precisely what makes the file portable: no external
 * references, KaTeX's rules present when the document has maths, and its fonts
 * carried inside rather than pointed at.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/** Run the real export inside the page and report on the result. */
const exportAndInspect = (page, markdown) =>
  page.evaluate(
    `(async () => {
      const mod = await import('/src/exportHtml.ts');
      const html = await mod.exportMarkdownToHtml(${JSON.stringify(markdown)}, {
        fileName: 'doc', lang: 'en', rtl: false, t: (k) => k,
      });
      const count = (re) => (html.match(re) || []).length;
      return {
        bytes: html.length,
        katexRules: count(/\\.katex/g),
        embeddedFonts: count(/url\\(data:font/g),
        relativeFontUrls: count(/url\\(\\s*["']?[^)"']*KaTeX_[^)"']*\\.woff2/g),
        links: count(/<link\\b/g),
        scripts: count(/<script\\b/g),
        remoteUrls: count(/url\\(\\s*["']?https?:/g),
      };
    })()`,
    60000,
  );

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── A document with maths carries KaTeX with it ───────────────────
  const withMath = await exportAndInspect(
    page,
    "# Report\n\n$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$\n\nInline $\\sum_{i=1}^{n} i$.\n",
  );

  assert(
    withMath.katexRules > 100,
    `KaTeX stylesheet should be embedded (found ${withMath.katexRules} rules)`,
  );
  assert(
    withMath.embeddedFonts > 0,
    `KaTeX fonts should travel as data URIs (found ${withMath.embeddedFonts})`,
  );
  assert(
    withMath.relativeFontUrls === 0,
    `no font may be referenced by path (found ${withMath.relativeFontUrls})`,
  );
  assert(withMath.links === 0, "the file must not link external stylesheets");
  assert(withMath.scripts === 0, "the file must not carry scripts");
  assert(
    withMath.remoteUrls === 0,
    `no stylesheet may fetch anything remote (found ${withMath.remoteUrls})`,
  );

  // ── A document without maths does not pay for it ──────────────────
  const plain = await exportAndInspect(page, "# Plain\n\nJust text, no maths.\n");
  // paged.css carries one .katex-display rule of its own, so the giveaway is
  // the fonts: those only travel when KaTeX's stylesheet is embedded.
  assert(
    plain.embeddedFonts === 0,
    `documents without maths should not carry KaTeX fonts (found ${plain.embeddedFonts})`,
  );
  assert(
    plain.katexRules < 20,
    `documents without maths should not embed the KaTeX stylesheet (found ${plain.katexRules} rules)`,
  );
  assert(
    plain.bytes < withMath.bytes,
    `a plain document should be smaller (${plain.bytes} vs ${withMath.bytes})`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `PASS: export-html.spec — self-contained (maths: ${(withMath.bytes / 1024).toFixed(0)} KB with ` +
      `${withMath.embeddedFonts} embedded fonts; plain: ${(plain.bytes / 1024).toFixed(0)} KB)`,
  );
} finally {
  page.close();
}
