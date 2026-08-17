import { describe, expect, it } from "vitest";
import { kindFromPath, normalizeDoc } from "./documentUtils";
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
