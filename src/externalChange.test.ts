import { describe, it, expect } from "vitest";
import { classifyExternalChange, type DocumentStat } from "./externalChange";

const BASE: NonNullable<DocumentStat> = { modifiedMs: 1000, size: 10 };
const SAME: NonNullable<DocumentStat> = { modifiedMs: 1000, size: 10 };
const MOVED: NonNullable<DocumentStat> = { modifiedMs: 2000, size: 12 };
const TOUCHED_SAME_SIZE: NonNullable<DocumentStat> = { modifiedMs: 2000, size: 10 };

describe("classifyExternalChange", () => {
  it("ignores unwatchable documents (stat failed / file deleted)", () => {
    const verdict = classifyExternalChange({
      baseline: BASE,
      current: null,
      diskContent: "",
      bufferContent: "buffer",
      dirty: true,
    });
    expect(verdict).toEqual({ action: "none" });
  });

  it("adopts a baseline on first sighting when the bytes still match", () => {
    const verdict = classifyExternalChange({
      baseline: null,
      current: MOVED,
      diskContent: "buffer",
      bufferContent: "buffer",
      dirty: false,
    });
    expect(verdict).toEqual({ action: "refresh-baseline" });
  });

  it("treats a divergent dirty buffer as a conflict even on first sighting", () => {
    // Sessions only reattach handles whose bytes matched the snapshot, so
    // this shape is rare — but if it happens, data safety wins over silence.
    const verdict = classifyExternalChange({
      baseline: null,
      current: MOVED,
      diskContent: "disk",
      bufferContent: "buffer",
      dirty: true,
    });
    expect(verdict).toEqual({ action: "conflict", diskContent: "disk" });
  });

  it("stays quiet when the fingerprint is unchanged", () => {
    const verdict = classifyExternalChange({
      baseline: BASE,
      current: SAME,
      diskContent: "whatever",
      bufferContent: "buffer",
      dirty: false,
    });
    expect(verdict).toEqual({ action: "none" });
  });

  it("detects a change through mtime alone (same size)", () => {
    const verdict = classifyExternalChange({
      baseline: BASE,
      current: TOUCHED_SAME_SIZE,
      diskContent: "disk",
      bufferContent: "buffer",
      dirty: true,
    });
    expect(verdict).toEqual({ action: "conflict", diskContent: "disk" });
  });

  it("silently adopts a same-content rewrite", () => {
    const verdict = classifyExternalChange({
      baseline: BASE,
      current: MOVED,
      diskContent: "buffer",
      bufferContent: "buffer",
      dirty: false,
    });
    expect(verdict).toEqual({ action: "refresh-baseline" });
  });

  it("reloads silently when the document is clean", () => {
    const verdict = classifyExternalChange({
      baseline: BASE,
      current: MOVED,
      diskContent: "new disk content",
      bufferContent: "old content",
      dirty: false,
    });
    expect(verdict).toEqual({ action: "reload", diskContent: "new disk content" });
  });

  it("raises a conflict when the document is dirty", () => {
    const verdict = classifyExternalChange({
      baseline: BASE,
      current: MOVED,
      diskContent: "their edit",
      bufferContent: "my edit",
      dirty: true,
    });
    expect(verdict).toEqual({ action: "conflict", diskContent: "their edit" });
  });
});
