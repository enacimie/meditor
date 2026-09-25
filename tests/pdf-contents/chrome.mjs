#!/usr/bin/env node
/**
 * The Chrome half of the PDF contents measurement: `fixture.html`, printed by
 * the Chrome the E2E harness finds, through `Page.printToPDF` — plainly,
 * tagged, with an outline, and with both. The PDFs go to the folder named by
 * MEDITOR_PDF_PROBE_DIR, for `describe-pdf.mjs` to read.
 *
 *   MEDITOR_PDF_PROBE_DIR=/some/folder node tests/pdf-contents/chrome.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, launchChrome } from "../e2e/cdp.mjs";

const out = process.env.MEDITOR_PDF_PROBE_DIR;
if (!out) {
  console.error("MEDITOR_PDF_PROBE_DIR is not set: nowhere to write the PDFs");
  process.exit(2);
}
const fixture = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "fixture.html")).href;

const chrome = await launchChrome({ url: "about:blank" });
try {
  const page = await connect(chrome.port);
  const version = await page.send("Browser.getVersion", {});
  console.log(`browser: ${version.result?.product}`);
  await page.navigate(fixture);
  await page.waitFor("document.readyState === 'complete'", { timeout: 15000 });
  const variants = {
    chrome: {},
    "chrome-tagged": { generateTaggedPDF: true },
    "chrome-outline": { generateDocumentOutline: true },
    "chrome-outline-tagged": { generateDocumentOutline: true, generateTaggedPDF: true },
  };
  for (const [name, options] of Object.entries(variants)) {
    const res = await page.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      ...options,
    });
    if (!res.result?.data) {
      console.log(`${name}: no PDF, ${JSON.stringify(res.error ?? res).slice(0, 200)}`);
      continue;
    }
    writeFileSync(join(out, `${name}.pdf`), Buffer.from(res.result.data, "base64"));
    console.log(`${name}: written`);
  }
  page.close();
} finally {
  await chrome.stop();
}
