/**
 * What came out of the printer, as opposed to what the view drew.
 *
 * The Document view and the printed sheet are not the same claim. paged.js
 * lays the pages out with a parser of its own, reading `paged.css` as text,
 * and the browser prints from the `@page` rules it finds in the document. A
 * geometry that reaches one and not the other looks perfect on screen and
 * comes out on the wrong paper — which is how the Document view shipped
 * broken in every built copy until #110: right in the view, wrong in the
 * thing handed over.
 *
 * So a spec that measures the sheet in the DOM has only made half the
 * assertion. This is the other half.
 */

import { assert } from "./cdp.mjs";

/** A4 and Letter in PostScript points, which is what a `/MediaBox` is in. */
export const A4_PT = [595, 842];
export const LETTER_PT = [612, 792];

/**
 * Print the page as it stands and read the sheets back out of the PDF.
 *
 * `preferCSSPageSize` is the whole point: without it the browser prints on
 * its own default paper and the document's `@page` size is ignored, so the
 * assertion would pass for the wrong reason on any machine whose default
 * happens to match.
 */
export async function printSheets(page) {
  const res = await page.send("Page.printToPDF", {
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pdf = Buffer.from(res.result.data, "base64").toString("latin1");
  return {
    // `/Type /Page` and not `/Pages`, which is the tree node above them.
    sheets: (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length,
    boxes: [
      ...pdf.matchAll(
        /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/g,
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]),
  };
}

/**
 * Every printed sheet is the paper named, within the rounding a PDF does.
 *
 * Three points of tolerance, the same as page-numbers.spec has used since
 * it was written: enough for the conversion, far short of the 17 mm that
 * separates A4 from Letter.
 */
export function assertPaper(boxes, [widthPt, heightPt], label) {
  assert(
    boxes.length > 0 &&
      boxes.every(
        ([w, h]) => Math.abs(w - widthPt) < 3 && Math.abs(h - heightPt) < 3,
      ),
    `${label}: every sheet should be ${widthPt}x${heightPt} pt, got ` +
      `${JSON.stringify(boxes.slice(0, 3))}`,
  );
}

/**
 * A PDF's bookmarks, as `[depth, title]` pairs in reading order.
 *
 * Chrome writes its PDFs through Skia: every dictionary as plain text. So the
 * outline is read as text — from the catalog's `/Outlines`, each item, then
 * its `/First` child, then its `/Next` sibling. A title that is not plain
 * ASCII comes in UTF-16 behind a byte order mark.
 */
export function outlineOf(pdf) {
  const text = Buffer.from(pdf).toString("latin1");
  const objects = new Map();
  for (const match of text.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) {
    objects.set(Number(match[1]), match[2]);
  }
  const reference = (body, key) => {
    const match = new RegExp(`${key}\\s+(\\d+)\\s+0\\s+R`).exec(body ?? "");
    return match ? Number(match[1]) : null;
  };
  const items = [];
  // A broken PDF could chain its items into a loop; no test has this many.
  const walk = (first, depth) => {
    for (let at = first; at !== null && items.length < 1000; ) {
      const body = objects.get(at);
      if (body === undefined) return;
      items.push([depth, titleOf(body)]);
      walk(reference(body, "/First"), depth + 1);
      at = reference(body, "/Next");
    }
  };
  const catalog = [...objects.values()].find((body) => /\/Type\s*\/Catalog/.test(body));
  const root = reference(catalog, "/Outlines");
  if (root !== null) walk(reference(objects.get(root), "/First"), 1);
  return items;
}

/** How many link annotations a PDF has: a table of contents' among them. */
export function linkCount(pdf) {
  return (Buffer.from(pdf).toString("latin1").match(/\/Subtype\s*\/Link\b/g) || []).length;
}

/**
 * The named destinations a PDF's links and bookmarks point at, and those of
 * them the PDF never defines: each one a click that goes nowhere.
 *
 * Chrome names a destination after the element's id (`/Dest /primero`) and
 * lists the names, each with its page, in the catalog's `/Dests`.
 */
export function namedDestinations(pdf) {
  const text = Buffer.from(pdf).toString("latin1");
  const NAME = "([^\\s/<>\\[\\]()]+)";
  const referenced = [
    ...new Set([...text.matchAll(new RegExp(`/Dest\\s*/${NAME}`, "g"))].map((m) => m[1])),
  ];
  const objects = new Map();
  for (const match of text.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) {
    objects.set(Number(match[1]), match[2]);
  }
  const catalog = [...objects.values()].find((body) => /\/Type\s*\/Catalog/.test(body)) ?? "";
  const reference = /\/Dests\s+(\d+)\s+0\s+R/.exec(catalog);
  const dests = reference ? (objects.get(Number(reference[1])) ?? "") : catalog;
  const defined = new Set(
    [...dests.matchAll(new RegExp(`/${NAME}\\s*\\[`, "g"))].map((m) => m[1]),
  );
  return { referenced, unresolved: referenced.filter((name) => !defined.has(name)) };
}

/** The text of the `/Title` in one object's body, hex or literal. */
function titleOf(body) {
  const at = body.indexOf("/Title");
  if (at < 0) return "";
  const rest = body.slice(at + "/Title".length).trimStart();
  let bytes;
  if (rest.startsWith("<")) {
    bytes = Buffer.from(rest.slice(1, rest.indexOf(">")).replace(/\s+/g, ""), "hex");
  } else if (rest.startsWith("(")) {
    bytes = literalBytes(rest.slice(1));
  } else {
    return "";
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const utf16 = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)));
    utf16.swap16();
    return utf16.toString("utf16le");
  }
  return bytes.toString("latin1");
}

/** The bytes of a literal string, from just after its opening parenthesis. */
function literalBytes(literal) {
  const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
  const bytes = [];
  let depth = 1;
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i];
    if (c === "\\") {
      const next = literal[++i];
      if (/[0-7]/.test(next)) {
        let octal = next;
        while (octal.length < 3 && /[0-7]/.test(literal[i + 1])) octal += literal[++i];
        bytes.push(parseInt(octal, 8) & 0xff);
      } else if (next in escapes) {
        bytes.push(escapes[next]);
      } else if (next !== undefined) {
        bytes.push(next.charCodeAt(0));
      }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) break;
    bytes.push(c.charCodeAt(0));
  }
  return Buffer.from(bytes);
}
