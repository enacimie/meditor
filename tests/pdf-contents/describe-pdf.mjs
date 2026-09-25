#!/usr/bin/env node
/**
 * What a PDF carries besides its pages: the document information, XMP, the
 * outline (bookmarks), the structure tree of a tagged PDF, named destinations
 * and link annotations. Reads plain objects and the ones packed into
 * compressed object streams alike, with nothing but Node's own zlib.
 *
 *   node tests/pdf-contents/describe-pdf.mjs a.pdf [b.json ...]
 *
 * A `.json` file is what the DevTools protocol's `Page.printToPDF` answered,
 * as the WebView2 probe saves it: the PDF is its `data`, in base64.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { inflateSync } from "node:zlib";

const DELIMITERS = " \t\r\n\f\0/[]<>(){}%";

class Parser {
  constructor(text, pos = 0) {
    this.s = text;
    this.i = pos;
  }

  ws() {
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === "%") {
        while (this.i < this.s.length && this.s[this.i] !== "\n" && this.s[this.i] !== "\r") this.i++;
      } else if (" \t\r\n\f\0".includes(c)) {
        this.i++;
      } else {
        return;
      }
    }
  }

  value() {
    this.ws();
    const s = this.s;
    const c = s[this.i];
    if (c === "<" && s[this.i + 1] === "<") return this.dict();
    if (c === "<") return this.hex();
    if (c === "[") return this.array();
    if (c === "(") return this.literal();
    if (c === "/") return this.name();
    const number = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(this.i, this.i + 40));
    if (number) {
      this.i += number[0].length;
      const ref = /^\s+(\d+)\s+R(?![A-Za-z])/.exec(s.slice(this.i, this.i + 40));
      if (ref && /^\d+$/.test(number[0])) {
        this.i += ref[0].length;
        return { ref: Number(number[0]) };
      }
      return Number(number[0]);
    }
    const word = /^[A-Za-z]+/.exec(s.slice(this.i, this.i + 20));
    if (word) {
      this.i += word[0].length;
      if (word[0] === "true") return true;
      if (word[0] === "false") return false;
      if (word[0] === "null") return null;
      return { keyword: word[0] };
    }
    throw new Error(`unexpected ${JSON.stringify(s.slice(this.i, this.i + 20))} at ${this.i}`);
  }

  dict() {
    this.i += 2;
    const out = {};
    for (;;) {
      this.ws();
      if (this.s[this.i] === ">" && this.s[this.i + 1] === ">") {
        this.i += 2;
        return out;
      }
      const key = this.name();
      out[key.name] = this.value();
    }
  }

  array() {
    this.i++;
    const out = [];
    for (;;) {
      this.ws();
      if (this.s[this.i] === "]") {
        this.i++;
        return out;
      }
      out.push(this.value());
    }
  }

  name() {
    this.ws();
    if (this.s[this.i] !== "/") throw new Error(`expected a name at ${this.i}`);
    let j = this.i + 1;
    while (j < this.s.length && !DELIMITERS.includes(this.s[j])) j++;
    const raw = this.s.slice(this.i + 1, j);
    this.i = j;
    return { name: raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
  }

  hex() {
    const end = this.s.indexOf(">", this.i);
    let digits = this.s.slice(this.i + 1, end).replace(/\s+/g, "");
    this.i = end + 1;
    if (digits.length % 2) digits += "0";
    return { bytes: Buffer.from(digits, "hex") };
  }

  literal() {
    this.i++;
    let depth = 1;
    const bytes = [];
    const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === "\\") {
        const next = this.s[this.i++];
        if (next in escapes) {
          bytes.push(escapes[next]);
        } else if (/[0-7]/.test(next)) {
          let octal = next;
          while (octal.length < 3 && /[0-7]/.test(this.s[this.i])) octal += this.s[this.i++];
          bytes.push(parseInt(octal, 8) & 0xff);
        } else if (next === "\r") {
          if (this.s[this.i] === "\n") this.i++;
        } else if (next !== "\n") {
          bytes.push(next.charCodeAt(0));
        }
        continue;
      }
      if (c === "(") depth++;
      if (c === ")" && --depth === 0) break;
      bytes.push(c.charCodeAt(0));
    }
    return { bytes: Buffer.from(bytes) };
  }
}

/** A PDF text string: UTF-16BE with its BOM, UTF-8 with its BOM, or bytes. */
function text(value) {
  if (value === undefined || value === null) return undefined;
  if (!value.bytes) return typeof value === "object" ? JSON.stringify(value) : String(value);
  const b = value.bytes;
  if (b[0] === 0xfe && b[1] === 0xff) {
    const swapped = Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1)));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString("utf8");
  return b.toString("latin1");
}

function decoded(object) {
  const filter = object.value?.Filter;
  const names = Array.isArray(filter) ? filter.map((f) => f.name) : filter ? [filter.name] : [];
  let data = object.stream;
  for (const name of names) {
    if (name !== "FlateDecode") return null;
    data = inflateSync(data);
  }
  return data;
}

function readObjects(buf) {
  const s = buf.toString("latin1");
  const objects = new Map();
  const header = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = header.exec(s))) {
    const parser = new Parser(s, header.lastIndex);
    let value;
    try {
      value = parser.value();
    } catch {
      continue;
    }
    let stream = null;
    parser.ws();
    if (s.startsWith("stream", parser.i)) {
      let start = parser.i + "stream".length;
      if (s[start] === "\r") start++;
      if (s[start] === "\n") start++;
      const end =
        typeof value?.Length === "number" ? start + value.Length : s.indexOf("endstream", start);
      stream = Buffer.from(s.slice(start, end), "latin1");
      header.lastIndex = end;
    }
    objects.set(Number(match[1]), { value, stream });
  }
  for (const object of [...objects.values()]) {
    if (object.value?.Type?.name !== "ObjStm" || !object.stream) continue;
    const data = decoded(object);
    if (!data) continue;
    const packed = data.toString("latin1");
    const first = object.value.First;
    const pairs = packed.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < object.value.N; k++) {
      const parser = new Parser(packed, first + pairs[2 * k + 1]);
      objects.set(pairs[2 * k], { value: parser.value(), stream: null });
    }
  }
  return objects;
}

function describe(file) {
  const buf = file.endsWith(".json")
    ? Buffer.from(JSON.parse(readFileSync(file, "utf8")).data, "base64")
    : readFileSync(file);
  const s = buf.toString("latin1");
  const objects = readObjects(buf);
  const get = (v) => (v && v.ref !== undefined ? objects.get(v.ref)?.value : v);
  const at = s.lastIndexOf("trailer");
  const trailer =
    at >= 0
      ? new Parser(s, at + "trailer".length).value()
      : [...objects.values()].reverse().find((o) => o.value?.Type?.name === "XRef")?.value;
  const info = get(trailer?.Info) ?? {};
  const root =
    get(trailer?.Root) ??
    [...objects.values()].find((o) => o.value?.Type?.name === "Catalog")?.value ??
    {};

  const outline = [];
  const walk = (node, depth) => {
    let guard = 0;
    for (let item = get(node?.First); item && guard < 10000; item = get(item.Next), guard++) {
      outline.push(`${"  ".repeat(depth - 1)}${text(item.Title)}`);
      walk(item, depth + 1);
    }
  };
  if (root.Outlines) walk(get(root.Outlines), 1);

  const links = [];
  const visit = (v) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object" && !v.bytes && v.ref === undefined && v.name === undefined) {
      if (v.Subtype?.name === "Link") links.push(v);
      Object.values(v).forEach(visit);
    }
  };
  for (const object of objects.values()) visit(object.value);
  const internal = links.filter((l) => l.Dest !== undefined || get(l.A)?.S?.name === "GoTo");
  const external = links.filter((l) => get(l.A)?.S?.name === "URI").map((l) => text(get(l.A).URI));

  let namedDestinations = 0;
  const countNames = (node) => {
    if (!node) return;
    if (Array.isArray(node.Names)) namedDestinations += node.Names.length / 2;
    (node.Kids ?? []).forEach((kid) => countNames(get(kid)));
  };
  countNames(get(get(root.Names)?.Dests));
  if (root.Dests) namedDestinations += Object.keys(get(root.Dests) ?? {}).length;

  let xmp;
  if (root.Metadata) {
    const object = objects.get(root.Metadata.ref);
    const data = object && (decoded(object) ?? object.stream);
    const xml = data?.toString("utf8") ?? "";
    const tag = (name) => new RegExp(`<${name}>[\\s\\S]*?<rdf:li[^>]*>([^<]*)<`).exec(xml)?.[1];
    xmp = { title: tag("dc:title"), creator: tag("dc:creator") };
  }

  return {
    file: basename(file),
    version: /%PDF-(\d\.\d)/.exec(s.slice(0, 16))?.[1],
    pages: [...objects.values()].filter((o) => o.value?.Type?.name === "Page").length,
    title: text(info.Title),
    author: text(info.Author),
    subject: text(info.Subject),
    keywords: text(info.Keywords),
    creator: text(info.Creator),
    producer: text(info.Producer),
    lang: text(root.Lang),
    xmp,
    outline,
    tagged: root.StructTreeRoot !== undefined,
    marked: get(root.MarkInfo)?.Marked ?? false,
    namedDestinations,
    internalLinks: internal.length,
    externalLinks: external,
  };
}

for (const file of process.argv.slice(2)) {
  const d = describe(file);
  console.log(`\n== ${d.file} (PDF ${d.version}, ${d.pages} pages)`);
  console.log(`  Title: ${d.title ?? "-"} | Author: ${d.author ?? "-"} | Subject: ${d.subject ?? "-"} | Keywords: ${d.keywords ?? "-"}`);
  console.log(`  Creator: ${d.creator ?? "-"} | Producer: ${d.producer ?? "-"} | Lang: ${d.lang ?? "-"}`);
  console.log(`  XMP: ${d.xmp ? JSON.stringify(d.xmp) : "-"} | tagged: ${d.tagged} (Marked ${d.marked})`);
  console.log(`  outline: ${d.outline.length ? d.outline.length + " items" : "none"}`);
  for (const line of d.outline) console.log(`    ${line}`);
  console.log(`  links: ${d.internalLinks} internal, ${d.externalLinks.length} external ${JSON.stringify(d.externalLinks)} | named destinations: ${d.namedDestinations}`);
}
