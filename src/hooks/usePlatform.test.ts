import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";
import { canPrintNatively } from "./usePlatform";

/**
 * The targets Rust prints on, as export.rs states them.
 *
 * Each of its "not supported" branches is compiled for every target outside
 * one list, and that list is where the webview can print. Read from the
 * source, so the frontend's copy cannot drift from it unnoticed.
 */
function targetsRustPrintsOn(): Set<string>[] {
  const source: string = readFileSync(
    new URL("../../src-tauri/src/export.rs", import.meta.url),
    "utf8",
  );
  return [...source.matchAll(/#\[cfg\(not\(any\(([^\]]*?)\)\)\)\]/g)].map(
    (block) => new Set([...block[1].matchAll(/target_os = "([a-z]+)"/g)].map((m) => m[1])),
  );
}

describe("canPrintNatively", () => {
  it("says yes exactly where Rust prints, for export and for Ctrl+P alike", () => {
    const blocks = targetsRustPrintsOn();
    // export_pdf and print_document, the two commands that print.
    expect(blocks).toHaveLength(2);
    const [exporting, printing] = blocks;
    expect(printing).toEqual(exporting);
    expect(exporting.size).toBeGreaterThan(0);
    // Some of what std::env::consts::OS can say, to show the list stops there.
    const others = ["macos", "ios", "android", "solaris", "illumos", "haiku", "fuchsia"];
    for (const os of [...exporting, ...others]) {
      expect(canPrintNatively(os), os).toBe(exporting.has(os));
    }
  });

  it("says no on a Mac and on a phone, where Rust answers 'not supported'", () => {
    for (const os of ["macos", "ios", "android"]) expect(canPrintNatively(os), os).toBe(false);
  });

  it("says yes in a browser, which prints through its own dialog", () => {
    expect(canPrintNatively("web")).toBe(true);
  });

  it("says yes before Rust has answered, so a desktop menu does not flicker", () => {
    expect(canPrintNatively(null)).toBe(true);
  });
});
