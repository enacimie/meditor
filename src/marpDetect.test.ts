import { describe, expect, it } from "vitest";
import { isMarpDocument } from "./marpDetect";

describe("isMarpDocument", () => {
  it("detects a marp: true front-matter", () => {
    expect(isMarpDocument("---\nmarp: true\n---\n\n# Hi\n")).toBe(true);
  });

  it("accepts quoted and case-varied values", () => {
    expect(isMarpDocument('---\nmarp: "true"\n---\n')).toBe(true);
    expect(isMarpDocument("---\nmarp: 'true'\n---\n")).toBe(true);
    expect(isMarpDocument("---\nmarp: TRUE\n---\n")).toBe(true);
  });

  it("accepts other keys around marp and a trailing comment", () => {
    expect(isMarpDocument("---\ntheme: gaia\nmarp: true # slides\nsize: 16:9\n---\n")).toBe(true);
  });

  it("accepts a ... closing delimiter", () => {
    expect(isMarpDocument("---\nmarp: true\n...\n\n# Hi\n")).toBe(true);
  });

  it("handles CRLF and a leading BOM", () => {
    expect(isMarpDocument("---\r\nmarp: true\r\n---\r\n# Hi\r\n")).toBe(true);
    expect(isMarpDocument("\uFEFF---\nmarp: true\n---\n")).toBe(true);
  });

  it("rejects marp: false or other values", () => {
    expect(isMarpDocument("---\nmarp: false\n---\n")).toBe(false);
    expect(isMarpDocument("---\nmarp: yes\n---\n")).toBe(false);
  });

  it("rejects front-matter without a marp key", () => {
    expect(isMarpDocument("---\ntitle: Notes\ntheme: gaia\n---\n# Hi\n")).toBe(false);
  });

  it("rejects documents with no front-matter", () => {
    expect(isMarpDocument("# Just a heading\n\n---\n\nslide two")).toBe(false);
    expect(isMarpDocument("plain text")).toBe(false);
    expect(isMarpDocument("")).toBe(false);
  });

  it("rejects an unclosed leading rule", () => {
    expect(isMarpDocument("---\nmarp: true\n# never closed")).toBe(false);
  });

  it("rejects marp:true without the space YAML requires", () => {
    expect(isMarpDocument("---\nmarp:true\n---\n")).toBe(false);
  });
});
