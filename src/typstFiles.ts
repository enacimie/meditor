import { backend } from "./backend";
import type { TypstFileStat } from "./backend/types";
import type { TypstInput } from "./typstWorkerProtocol";

/**
 * The files a Typst document reads from beside it.
 *
 * `#include "chapter.typ"`, `#import "lib.typ": x`, `#image("figure.png")`,
 * `json("data.json")`, `#bibliography("refs.bib")`: the compiler runs in a
 * worker with no filesystem, so each file has to be found, read through the
 * backend (typst_files.rs, which keeps it to the document's own folder) and
 * handed over before the document compiles.
 *
 * Found by reading the source, not by compiling it: a path written as a
 * string where Typst reads a file is a file to fetch, and an included or
 * imported `.typ` is read the same way in its turn. A path built while the
 * document runs (`image("fig" + str(n) + ".png")`) is not seen, and neither
 * is a package (`@preview/…`), which would need the network.
 *
 * Kept, like the images a Markdown document shows, because the preview
 * compiles on every pause in typing: each file is re-read only when its
 * fingerprint moves, which costs one backend call per file per compile.
 */

/** How deep `#include` and `#import` may nest before the rest is left out. */
export const MAX_DEPTH = 8;
/** How many files one document may read. */
export const MAX_FILES = 256;
/** How much one document may read, in all. */
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** The largest file the backend gives: typst_files.rs's MAX_TYPST_FILE_BYTES, for the message. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** A file the compiler is given: where it sits, what it holds, and its fingerprint. */
export type TypstFile = { key: string; bytes: Uint8Array };

/** Why a file the document names was not given to the compiler. */
export type TypstFileProblem = {
  path: string;
  reason: "missing" | "invalid" | "outside" | "unsupported" | "tooLarge" | "limit";
};

export type CollectedFiles = {
  /** By path within the document's folder: `chapters/one.typ`. */
  files: Map<string, TypstFile>;
  problems: TypstFileProblem[];
  /** False when the backend has no folder to read from (a content URI, the web). */
  available: boolean;
};

/** Where a document's files are read from. */
export type TypstFileSource = { handle: string; locale: string };

/** Functions that read a file by the path in their first string argument. */
const READS = /\b(image|read|json|yaml|toml|csv|xml|cbor|bibliography|plugin)\s*\(\s*"((?:[^"\\]|\\.)*)"/g;
/** `bibliography(("a.bib", "b.bib"))`: several files at once. */
const READS_SEVERAL = /\bbibliography\s*\(\s*\(([^)]*)\)/g;
/** `include "x.typ"` and `import "x.typ"`, which are keywords, not calls. */
const KEYWORDS = /\b(include|import)\s+"((?:[^"\\]|\\.)*)"/g;
/** A citation style given as a file, `style: "custom.csl"`; any other style is built in. */
const STYLE_FILE = /\bstyle\s*:\s*"((?:[^"\\]|\\.)*\.csl)"/g;
const STRING = /"((?:[^"\\]|\\.)*)"/g;

/** A Typst string literal's content, with its escapes undone. */
function unescape(literal: string): string {
  return literal.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_, escape: string, code?: string) => {
    if (code) return String.fromCodePoint(parseInt(code, 16));
    return { n: "\n", r: "\r", t: "\t" }[escape as "n" | "r" | "t"] ?? escape;
  });
}

/**
 * The source with its comments and raw text blanked out, strings kept.
 *
 * A path in a comment is not read, and neither is one in a raw block, which
 * is code shown on the page. Blanked rather than removed, so that nothing
 * else moves; Typst's block comments nest, and a `//` inside a string (a URL)
 * is part of the string.
 */
function withoutCommentsOrRaw(source: string): string {
  let out = "";
  let at = 0;
  while (at < source.length) {
    const c = source[at];
    if (c === '"') {
      let end = at + 1;
      while (end < source.length && source[end] !== '"' && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      out += source.slice(at, end + 1);
      at = end + 1;
    } else if (source.startsWith("//", at)) {
      const end = source.indexOf("\n", at);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - at);
      at = stop;
    } else if (source.startsWith("/*", at)) {
      let depth = 0;
      let end = at;
      while (end < source.length) {
        if (source.startsWith("/*", end)) {
          depth++;
          end += 2;
        } else if (source.startsWith("*/", end)) {
          depth--;
          end += 2;
          if (depth === 0) break;
        } else {
          end++;
        }
      }
      out += source.slice(at, end).replace(/[^\n]/g, " ");
      at = end;
    } else if (c === "`") {
      let ticks = 0;
      while (source[at + ticks] === "`") ticks++;
      const fence = "`".repeat(ticks);
      const close = source.indexOf(fence, at + ticks);
      const end = close === -1 ? source.length : close + ticks;
      out += source.slice(at, end).replace(/[^\n]/g, " ");
      at = end;
    } else {
      out += c;
      at++;
    }
  }
  return out;
}

/** The paths a Typst source names where Typst reads a file, as written, in the order it names them. */
export function typstFileReferences(source: string): string[] {
  const code = withoutCommentsOrRaw(source);
  const found: Array<{ at: number; path: string }> = [];
  for (const match of code.matchAll(READS)) found.push({ at: match.index, path: unescape(match[2]) });
  for (const match of code.matchAll(READS_SEVERAL)) {
    for (const inner of match[1].matchAll(STRING)) {
      found.push({ at: match.index + inner.index, path: unescape(inner[1]) });
    }
  }
  for (const match of code.matchAll(KEYWORDS)) found.push({ at: match.index, path: unescape(match[2]) });
  for (const match of code.matchAll(STYLE_FILE)) found.push({ at: match.index, path: unescape(match[1]) });
  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((entry) => entry.path))];
}

/**
 * The path within the document's folder that `written` names, from the file
 * at `from` (itself a path within the folder; the main document's is its
 * name). Null for what is not a file there: a package, a URL.
 *
 * As Typst resolves it: relative to the directory of the file that wrote it,
 * or, starting with `/`, to the folder itself. A path that climbs out of the
 * folder keeps its `..`, so that the backend refuses it and says why.
 */
export function resolveTypstPath(from: string, written: string): string | null {
  if (!written || written.startsWith("@") || written.includes("://")) return null;
  const base = written.startsWith("/") ? [] : from.split("/").slice(0, -1);
  const parts = [...base];
  let above = 0;
  for (const part of written.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
      else above++;
    } else {
      parts.push(part);
    }
  }
  if (!parts.length) return null;
  return [...Array(above).fill(".."), ...parts].join("/");
}

/** The bytes already read, by document and path, with the fingerprint they were read at. */
const cache = new Map<string, TypstFile>();
let cachedBytes = 0;

/** Keep `file` as the most recently used, and forget the least recently used past the cap. */
function remember(cacheKey: string, file: TypstFile): void {
  const old = cache.get(cacheKey);
  if (old) cachedBytes -= old.bytes.length;
  cache.delete(cacheKey);
  cache.set(cacheKey, file);
  cachedBytes += file.bytes.length;
  // Insertion order is the order of use: the least recent go first.
  for (const [key, entry] of cache) {
    if (cachedBytes <= MAX_TOTAL_BYTES) break;
    cache.delete(key);
    cachedBytes -= entry.bytes.length;
  }
}

/** Forget every file read so far. For the tests, and for nothing else. */
export function clearTypstFileCache(): void {
  cache.clear();
  cachedBytes = 0;
}

function fingerprint(stat: TypstFileStat & { state: "found" }): string {
  return `${stat.stat?.modifiedMs ?? ""}:${stat.stat?.size ?? ""}`;
}

const decoder = new TextDecoder();

/**
 * Every file the document at `mainName` reads, as far as `#include` and
 * `#import` lead, with what could not be given and why.
 */
export async function collectTypstFiles(
  mainName: string,
  source: string,
  from: TypstFileSource,
): Promise<CollectedFiles> {
  const files = new Map<string, TypstFile>();
  const problems: TypstFileProblem[] = [];
  const seen = new Set<string>([mainName]);
  let total = 0;
  let queue: Array<{ path: string; depth: number }> = typstFileReferences(source)
    .map((written) => resolveTypstPath(mainName, written))
    .filter((path): path is string => path !== null && !seen.has(path))
    .map((path) => ({ path, depth: 1 }));

  while (queue.length) {
    const next: typeof queue = [];
    for (const { path, depth } of queue) {
      if (seen.has(path)) continue;
      seen.add(path);
      if (files.size >= MAX_FILES || depth > MAX_DEPTH) {
        problems.push({ path, reason: "limit" });
        continue;
      }
      const stat = await backend.typstFileStat(from.handle, path, from.locale).catch(() => null);
      if (!stat || stat.state === "missing") {
        problems.push({ path, reason: "missing" });
        continue;
      }
      if (stat.state === "unavailable") return { files: new Map(), problems: [], available: false };
      if (stat.state === "refused") {
        problems.push({ path, reason: stat.reason });
        continue;
      }
      // Not read at all when its size alone would go past what the document
      // may read; and checked again once read, in case it grew in between.
      if (total + (stat.stat?.size ?? 0) > MAX_TOTAL_BYTES) {
        problems.push({ path, reason: "limit" });
        continue;
      }
      const key = fingerprint(stat);
      const cacheKey = `${from.handle}::${path}`;
      let file = cache.get(cacheKey);
      if (!file || file.key !== key) {
        const bytes = await backend.readTypstFile(from.handle, path, from.locale).catch(() => null);
        if (!bytes) {
          problems.push({ path, reason: "missing" });
          continue;
        }
        file = { key, bytes };
      }
      remember(cacheKey, file);
      if (total + file.bytes.length > MAX_TOTAL_BYTES) {
        problems.push({ path, reason: "limit" });
        continue;
      }
      total += file.bytes.length;
      files.set(path, file);
      if (path.toLowerCase().endsWith(".typ")) {
        for (const written of typstFileReferences(decoder.decode(file.bytes))) {
          const child = resolveTypstPath(path, written);
          if (child !== null && !seen.has(child)) next.push({ path: child, depth: depth + 1 });
        }
      }
    }
    queue = next;
  }
  return { files, problems, available: true };
}

/** What a Typst document is compiled from, and what could not be given to it. */
export type PreparedTypst = {
  input: TypstInput;
  /** The files left out, and why. A missing one is not here: Typst names it itself. */
  problems: TypstFileProblem[];
  /**
   * Why none of the files the document names could be given: it has never
   * been saved, so it has no folder yet, or it was opened from where the
   * backend has none to read (the web, a phone's document provider).
   */
  unavailable: "unsaved" | "noFolder" | null;
  /** Moves whenever what the compiler is given would: a file, its fingerprint, a problem. */
  signature: string;
};

/** The name a document has in its folder, from its path; Typst's own default without one. */
export function typstMainName(path: string | null | undefined): string {
  return path?.split(/[/\\]/).pop() || "main.typ";
}

/**
 * The input to compile `source` from, with the files beside it that it names.
 *
 * `from` is absent for a document that has never been saved. The preview and
 * the PDF export both come through here, so that what is exported is what
 * the preview showed. A document that names no file compiles on its own, as
 * every document did before it could read any.
 */
export async function prepareTypst(
  source: string,
  mainName: string,
  from: TypstFileSource | undefined,
): Promise<PreparedTypst> {
  const alone: PreparedTypst = { input: { mainContent: source }, problems: [], unavailable: null, signature: "" };
  if (!typstFileReferences(source).some((written) => resolveTypstPath(mainName, written) !== null)) return alone;
  if (!from) return { ...alone, unavailable: "unsaved" };
  const collected = await collectTypstFiles(mainName, source, from);
  if (!collected.available) return { ...alone, unavailable: "noFolder" };
  const signature = [
    ...[...collected.files].map(([path, file]) => `${path}=${file.key}`),
    ...collected.problems.map((problem) => `${problem.path}!${problem.reason}`),
  ].join("\n");
  return {
    input: {
      mainContent: source,
      folder: { id: from.handle, mainPath: `/${mainName}`, files: collected.files },
    },
    problems: collected.problems.filter((problem) => problem.reason !== "missing"),
    unavailable: null,
    signature,
  };
}
