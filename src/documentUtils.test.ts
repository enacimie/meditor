import { describe, expect, it } from "vitest";
import { kindFromPath, nextUntitledName, normalizeDoc } from "./documentUtils";
import type { Doc } from "./types";

describe("documentUtils", () => {
  it("detects supported document kinds from paths", () => {
    expect(kindFromPath("paper.typ")).toBe("typst");
    expect(kindFromPath("paper.typst")).toBe("typst");
    expect(kindFromPath("paper.tex")).toBe("latex");
    expect(kindFromPath("paper.ltx")).toBe("latex");
    expect(kindFromPath("paper.md")).toBe("markdown");
  });

  it("normalizes old native payloads without kind", () => {
    const oldPayload = {
      id: "old",
      name: "paper.tex",
      path: "/tmp/paper.tex",
      content: "\\documentclass{article}",
      dirty: false,
    } as Doc;

    expect(normalizeDoc(oldPayload).kind).toBe("latex");
  });

  it("defaults untitled and invalid kinds to Markdown", () => {
    const payload = {
      id: "untitled",
      name: "Document",
      path: null,
      content: "text",
      dirty: false,
      kind: "unknown",
    } as unknown as Doc;

    expect(normalizeDoc(payload).kind).toBe("markdown");
  });
});

describe("nextUntitledName", () => {
  const doc = (name: string): Doc =>
    ({ id: name, name, path: null, content: "", dirty: false, kind: "markdown" }) as Doc;

  it("starts at one with nothing open", () => {
    expect(nextUntitledName([])).toBe("Doc 1");
  });

  it("skips the names already on a tab", () => {
    expect(nextUntitledName([doc("Doc 1")])).toBe("Doc 2");
    expect(nextUntitledName([doc("Doc 1"), doc("Doc 2")])).toBe("Doc 3");
  });

  it("fills a gap rather than counting past it", () => {
    expect(nextUntitledName([doc("Doc 2"), doc("Doc 3")])).toBe("Doc 1");
  });

  it("never repeats a name that a restored session brought back", () => {
    // The bug this replaces: a counter reset to zero on launch, so the first
    // new tab after restoring a session called itself Doc 1 all over again.
    const restored = [doc("Doc 1"), doc("Doc 3")];
    const chosen = nextUntitledName(restored);
    expect(restored.map((d) => d.name)).not.toContain(chosen);
    expect(chosen).toBe("Doc 2");
  });

  it("ignores documents that have a filename of their own", () => {
    expect(nextUntitledName([doc("notes.md"), doc("Doc 1")])).toBe("Doc 2");
  });
});
