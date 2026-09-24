import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";
import type { TypstFileStat } from "./backend/types";

/**
 * A folder of files, as the backend would find them, by path within it. A
 * file given a `size` is that many zero bytes rather than its text, and one
 * given a `readSize` as well grew between the look and the read.
 */
const disk = vi.hoisted(() => ({
  files: new Map<string, { text: string; modified: number; size?: number; readSize?: number }>(),
  refused: new Map<string, "invalid" | "outside" | "unsupported" | "tooLarge">(),
  unavailable: false,
}));

vi.mock("./backend", () => ({
  backend: {
    typstFileStat: vi.fn(async (_handle: string, path: string): Promise<TypstFileStat> => {
      if (disk.unavailable) return { state: "unavailable" };
      const refused = disk.refused.get(path);
      if (refused) return { state: "refused", reason: refused };
      const file = disk.files.get(path);
      return file
        ? { state: "found", stat: { modifiedMs: file.modified, size: file.size ?? file.text.length } }
        : { state: "missing" };
    }),
    readTypstFile: vi.fn(async (_handle: string, path: string) => {
      const file = disk.files.get(path)!;
      const size = file.readSize ?? file.size;
      return size === undefined ? new TextEncoder().encode(file.text) : new Uint8Array(size);
    }),
  },
}));

const MIB = 1024 * 1024;

const { backend } = await import("./backend");
const {
  MAX_DEPTH,
  MAX_FILE_BYTES,
  MAX_FILES,
  clearTypstFileCache,
  collectTypstFiles,
  prepareTypst,
  resolveTypstPath,
  typstFileReferences,
  typstMainName,
} = await import("./typstFiles");

const FROM = { handle: "doc", locale: "en" };

beforeEach(() => {
  disk.files.clear();
  disk.refused.clear();
  disk.unavailable = false;
  clearTypstFileCache();
  vi.mocked(backend.typstFileStat).mockClear();
  vi.mocked(backend.readTypstFile).mockClear();
});

describe("the files a Typst source names", () => {
  it("are found by each function and keyword that reads one", () => {
    const source = [
      '#include "chapter.typ"',
      '#import "lib.typ": helper',
      '#image("fig.png", width: 50%)',
      '#let data = json("data.json")',
      '#let rows = csv("table.csv")',
      '#let config = (yaml("a.yml"), toml("b.toml"), xml("c.xml"), cbor("d.cbor"))',
      '#raw(read("notes.txt"))',
      '#bibliography("refs.bib", style: "house.csl")',
      '#let p = plugin("tool.wasm")',
    ].join("\n");
    expect(typstFileReferences(source).sort()).toEqual(
      [
        "a.yml", "b.toml", "c.xml", "chapter.typ", "d.cbor", "data.json", "fig.png", "house.csl",
        "lib.typ", "notes.txt", "refs.bib", "table.csv", "tool.wasm",
      ].sort(),
    );
  });

  it("include every bibliography given at once", () => {
    expect(typstFileReferences('#bibliography(("a.bib", "b.yml"))').sort()).toEqual(["a.bib", "b.yml"]);
  });

  it("leave out what is in a comment or in raw text", () => {
    const source = [
      '// #image("line-comment.png")',
      '/* #include "block.typ" /* nested */ #image("still-inside.png") */',
      'Shown as code: `#image("inline-raw.png")`',
      "```typ",
      '#include "raw-block.typ"',
      "```",
      '#image("real.png")',
    ].join("\n");
    expect(typstFileReferences(source)).toEqual(["real.png"]);
  });

  it("do not lose what follows a // inside a string", () => {
    expect(typstFileReferences('#let site = "https://example.com"; #image("after.png")')).toEqual(["after.png"]);
  });

  it("are read with their escapes undone", () => {
    expect(typstFileReferences('#image("my \\"quoted\\" figure.png")')).toEqual(['my "quoted" figure.png']);
    expect(typstFileReferences('#image("caf\\u{e9}.png")')).toEqual(["café.png"]);
  });

  it("take a citation style for a file only when it is one", () => {
    expect(typstFileReferences('#bibliography("r.bib", style: "apa")')).toEqual(["r.bib"]);
  });
});

describe("a path a Typst file writes", () => {
  it("is relative to the file that writes it, or from the folder's top with /", () => {
    expect(resolveTypstPath("report.typ", "fig.png")).toBe("fig.png");
    expect(resolveTypstPath("chapters/one.typ", "fig.png")).toBe("chapters/fig.png");
    expect(resolveTypstPath("chapters/one.typ", "/fig.png")).toBe("fig.png");
    expect(resolveTypstPath("chapters/one.typ", "./a/../b.png")).toBe("chapters/b.png");
    expect(resolveTypstPath("chapters/one.typ", "../fig.png")).toBe("fig.png");
  });

  it("keeps its way out of the folder, for the backend to refuse and say so", () => {
    expect(resolveTypstPath("report.typ", "../shared/fig.png")).toBe("../shared/fig.png");
    expect(resolveTypstPath("chapters/one.typ", "../../x.typ")).toBe("../x.typ");
  });

  it("is no file at all for a package or a URL", () => {
    expect(resolveTypstPath("report.typ", "@preview/cetz:0.3.0")).toBeNull();
    expect(resolveTypstPath("report.typ", "https://example.com/x.png")).toBeNull();
    expect(resolveTypstPath("report.typ", ".")).toBeNull();
  });
});

describe("collecting a document's files", () => {
  it("follows includes and imports, each resolving from where it sits", async () => {
    disk.files.set("chapters/one.typ", { text: '#image("fig.png")\n#import "/lib.typ": x', modified: 1 });
    disk.files.set("chapters/fig.png", { text: "PNG", modified: 1 });
    disk.files.set("lib.typ", { text: "#let x = 1", modified: 1 });
    const { files, problems, available } = await collectTypstFiles("report.typ", '#include "chapters/one.typ"', FROM);
    expect(available).toBe(true);
    expect([...files.keys()].sort()).toEqual(["chapters/fig.png", "chapters/one.typ", "lib.typ"]);
    expect(new TextDecoder().decode(files.get("chapters/fig.png")!.bytes)).toBe("PNG");
    expect(problems).toEqual([]);
  });

  it("reads a file again only when its fingerprint moves", async () => {
    disk.files.set("fig.png", { text: "one", modified: 1 });
    await collectTypstFiles("report.typ", '#image("fig.png")', FROM);
    const again = await collectTypstFiles("report.typ", '#image("fig.png")', FROM);
    expect(backend.readTypstFile).toHaveBeenCalledTimes(1);
    disk.files.set("fig.png", { text: "two", modified: 2 });
    const changed = await collectTypstFiles("report.typ", '#image("fig.png")', FROM);
    expect(backend.readTypstFile).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(again.files.get("fig.png")!.bytes)).toBe("one");
    expect(new TextDecoder().decode(changed.files.get("fig.png")!.bytes)).toBe("two");
  });

  it("says why each file it could not give was left out", async () => {
    disk.refused.set("../up.typ", "invalid");
    disk.refused.set("big.png", "tooLarge");
    disk.refused.set("tool.wasm", "unsupported");
    const source = '#include "../up.typ"\n#image("big.png")\n#plugin("tool.wasm")\n#image("gone.png")';
    const { files, problems } = await collectTypstFiles("report.typ", source, FROM);
    expect(files.size).toBe(0);
    expect(problems).toEqual([
      { path: "../up.typ", reason: "invalid" },
      { path: "big.png", reason: "tooLarge" },
      { path: "tool.wasm", reason: "unsupported" },
      { path: "gone.png", reason: "missing" },
    ]);
  });

  it("stops following includes past the deepest nesting", async () => {
    for (let n = 1; n <= MAX_DEPTH + 2; n++) {
      disk.files.set(`n${n}.typ`, { text: `#include "n${n + 1}.typ"`, modified: 1 });
    }
    const { files, problems } = await collectTypstFiles("report.typ", '#include "n1.typ"', FROM);
    expect(files.size).toBe(MAX_DEPTH);
    expect(problems).toEqual([{ path: `n${MAX_DEPTH + 1}.typ`, reason: "limit" }]);
  });

  it("stops at the most files one document may read", async () => {
    const names = Array.from({ length: MAX_FILES + 3 }, (_, n) => `f${n}.png`);
    for (const name of names) disk.files.set(name, { text: "x", modified: 1 });
    const source = names.map((name) => `#image("${name}")`).join("\n");
    const { files, problems } = await collectTypstFiles("report.typ", source, FROM);
    expect(files.size).toBe(MAX_FILES);
    expect(problems.map((problem) => problem.reason)).toEqual(["limit", "limit", "limit"]);
  });

  it("does not go round a loop of includes, or take the document for its own file", async () => {
    disk.files.set("a.typ", { text: '#include "b.typ"', modified: 1 });
    disk.files.set("b.typ", { text: '#include "a.typ"\n#include "report.typ"', modified: 1 });
    const { files, problems } = await collectTypstFiles("report.typ", '#include "a.typ"', FROM);
    expect([...files.keys()].sort()).toEqual(["a.typ", "b.typ"]);
    // Going round would end at the deepest nesting, and say so.
    expect(problems).toEqual([]);
    expect(backend.typstFileStat).toHaveBeenCalledTimes(2);
  });

  it("stops at the most one document may read in all, without reading what would go past it", async () => {
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) disk.files.set(name, { text: "", size: 25 * MIB, modified: 1 });
    const source = '#image("a.pdf")\n#image("b.pdf")\n#image("c.pdf")';
    const { files, problems } = await collectTypstFiles("report.typ", source, FROM);
    expect([...files.keys()]).toEqual(["a.pdf", "b.pdf"]);
    expect(problems).toEqual([{ path: "c.pdf", reason: "limit" }]);
    expect(backend.readTypstFile).toHaveBeenCalledTimes(2);
  });

  it("stops too at a file that grew past it between the look and the read", async () => {
    disk.files.set("a.pdf", { text: "", size: 25 * MIB, modified: 1 });
    disk.files.set("b.pdf", { text: "", size: 25 * MIB, modified: 1 });
    disk.files.set("c.pdf", { text: "", size: 10 * MIB, readSize: 20 * MIB, modified: 1 });
    const source = '#image("a.pdf")\n#image("b.pdf")\n#image("c.pdf")';
    const { files, problems } = await collectTypstFiles("report.typ", source, FROM);
    expect([...files.keys()]).toEqual(["a.pdf", "b.pdf"]);
    expect(problems).toEqual([{ path: "c.pdf", reason: "limit" }]);
  });

  it("forgets first the files used least recently, once it holds more than it may", async () => {
    disk.files.set("big.pdf", { text: "", size: 25 * MIB, modified: 1 });
    const read = (handle: string) => collectTypstFiles("x.typ", '#image("big.pdf")', { handle, locale: "en" });
    await read("one");
    await read("two");
    await read("one");
    // A third 25 MiB is past the 64 MiB kept: the one used least recently goes.
    await read("three");
    expect(backend.readTypstFile).toHaveBeenCalledTimes(3);
    await read("one");
    expect(backend.readTypstFile).toHaveBeenCalledTimes(3);
    await read("two");
    expect(backend.readTypstFile).toHaveBeenCalledTimes(4);
  });

  it("has nothing to give where there is no folder to read", async () => {
    disk.unavailable = true;
    const { files, problems, available } = await collectTypstFiles("report.typ", '#image("fig.png")', FROM);
    expect({ files: files.size, problems, available }).toEqual({ files: 0, problems: [], available: false });
  });
});

describe("what a Typst document is compiled from", () => {
  it("is its folder's files, from its own place there, for a saved document", async () => {
    disk.files.set("fig.png", { text: "PNG", modified: 1 });
    const { input, problems, unavailable } = await prepareTypst('#image("fig.png")', "report.typ", FROM);
    expect(input.mainContent).toBe('#image("fig.png")');
    expect(input.folder?.id).toBe("doc");
    expect(input.folder?.mainPath).toBe("/report.typ");
    expect([...input.folder!.files.keys()]).toEqual(["fig.png"]);
    expect({ problems, unavailable }).toEqual({ problems: [], unavailable: null });
  });

  it("leaves to Typst the files that are missing, and reports the rest", async () => {
    disk.refused.set("big.png", "tooLarge");
    const { problems } = await prepareTypst('#image("gone.png")\n#image("big.png")', "report.typ", FROM);
    expect(problems).toEqual([{ path: "big.png", reason: "tooLarge" }]);
  });

  it("is the source alone, as it always was, for a saved document that names no file", async () => {
    for (const source of ["= Hello", '#import "@preview/cetz:0.3.0"']) {
      expect(await prepareTypst(source, "report.typ", FROM)).toEqual({
        input: { mainContent: source },
        problems: [],
        unavailable: null,
        signature: "",
      });
    }
    expect(backend.typstFileStat).not.toHaveBeenCalled();
  });

  it("is the source alone for an unsaved document, which is told to save only if it names a file", async () => {
    const named = await prepareTypst('#image("fig.png")', "main.typ", undefined);
    expect(named.input).toEqual({ mainContent: '#image("fig.png")' });
    expect(named.unavailable).toBe("unsaved");
    expect((await prepareTypst("= Hello", "main.typ", undefined)).unavailable).toBeNull();
    expect((await prepareTypst('#import "@preview/cetz:0.3.0"', "main.typ", undefined)).unavailable).toBeNull();
    expect(backend.typstFileStat).not.toHaveBeenCalled();
  });

  it("is the source alone where the backend has no folder to read", async () => {
    disk.unavailable = true;
    const { input, unavailable } = await prepareTypst('#image("fig.png")', "report.typ", FROM);
    expect(input).toEqual({ mainContent: '#image("fig.png")' });
    expect(unavailable).toBe("noFolder");
  });

  it("changes its signature when a file changes, and when a missing one appears", async () => {
    const source = '#image("fig.png")\n#include "later.typ"';
    disk.files.set("fig.png", { text: "one", modified: 1 });
    const first = (await prepareTypst(source, "report.typ", FROM)).signature;
    expect((await prepareTypst(source, "report.typ", FROM)).signature).toBe(first);
    disk.files.set("fig.png", { text: "two", modified: 2 });
    const second = (await prepareTypst(source, "report.typ", FROM)).signature;
    expect(second).not.toBe(first);
    disk.files.set("later.typ", { text: "= Later", modified: 1 });
    expect((await prepareTypst(source, "report.typ", FROM)).signature).not.toBe(second);
  });

  it("changes its signature when only why a file was left out changes", async () => {
    // The compiler is given the same, but the preview has something new to say.
    const source = '#include "later.typ"';
    const missing = (await prepareTypst(source, "report.typ", FROM)).signature;
    disk.refused.set("later.typ", "tooLarge");
    const refused = await prepareTypst(source, "report.typ", FROM);
    expect(refused.input.folder?.files.size).toBe(0);
    expect(refused.signature).not.toBe(missing);
  });
});

describe("a document's name in its folder", () => {
  it("is the last part of its path, whichever separator the system uses", () => {
    expect(typstMainName("C:\\Users\\me\\thesis\\report.typ")).toBe("report.typ");
    expect(typstMainName("/home/me/thesis/report.typ")).toBe("report.typ");
  });

  it("is Typst's own default without a path", () => {
    expect(typstMainName(null)).toBe("main.typ");
    expect(typstMainName(undefined)).toBe("main.typ");
  });
});

it("names the largest file the backend gives, not another number", () => {
  const rust = readFileSync(new URL("../src-tauri/src/typst_files.rs", import.meta.url), "utf8") as string;
  const limit = /const MAX_TYPST_FILE_BYTES: u64 = (\d+) \* 1024 \* 1024;/.exec(rust);
  expect(limit, "MAX_TYPST_FILE_BYTES is no longer written as N * 1024 * 1024").not.toBeNull();
  expect(MAX_FILE_BYTES).toBe(Number(limit![1]) * 1024 * 1024);
});
