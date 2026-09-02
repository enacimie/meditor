/**
 * The Tauri config overlays have to be layered in two places, and the script
 * that does one of them says so itself:
 *
 *   "The release pipeline does not go through this script (tauri-action
 *    invokes the CLI directly), so it applies the same overlay itself — keep
 *    both in sync."
 *
 * That comment was already there when `conf/updater-enabled.json` was added to
 * the workflow and not to the script. Nothing caught it: the release pipeline
 * never runs the forwarder, so no job exercises the path where they disagree,
 * and both halves are green on their own. It took reading the two files side
 * by side, which is the job this test now has.
 *
 * What it can and cannot say: it proves the overlay is passed to the CLI in
 * both paths, not that the overlay does anything useful. That is the whole of
 * the invariant here — two config files agreeing — and there is no local
 * behaviour to measure instead.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8") as string;

const workflow = read("../.github/workflows/release.yml");
const forwarder = read("../scripts/tauri.mjs");

/** Every `src-tauri/conf/<name>.json` a file mentions, deduplicated. */
function overlays(source: string): string[] {
  const found = source.match(/src-tauri\/conf\/[\w.-]+\.json/g) ?? [];
  return [...new Set(found)].sort();
}

describe("Tauri config overlays", () => {
  it("names at least one overlay in the release workflow", () => {
    // Guards the regex itself: if the workflow ever spells these differently,
    // the comparison below would pass by finding nothing on either side.
    expect(overlays(workflow).length).toBeGreaterThan(0);
  });

  it("layers in the forwarder every overlay the release layers", () => {
    const inForwarder = new Set(overlays(forwarder));
    const missing = overlays(workflow).filter((path) => !inForwarder.has(path));
    expect(
      missing,
      `layered by .github/workflows/release.yml but not by scripts/tauri.mjs, so a local ` +
        `build gets a different app than the release does:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
