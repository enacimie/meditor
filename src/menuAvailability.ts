/**
 * Which entries the main menu offers for the document and platform in front
 * of it. Moved out of App.tsx unchanged, each flag now a function of what it
 * reads.
 */
import { isTauri } from "@tauri-apps/api/core";
import { canPrintNatively, isMobilePlatform, type Platform } from "./hooks/usePlatform";
import { LATEX_ENABLED } from "./latexSupport";
import type { DocKind } from "./types";

/*
 * Whether "export to PDF" leads anywhere for the document in front of us.
 *
 * Not a single answer per platform, because the two routes are different.
 * Typst and LaTeX compile to PDF in the frontend's own WASM and hand the
 * bytes to Rust to write, which works anywhere the file dialog does —
 * Android included. Markdown goes through the webview's native printing,
 * which exists on Windows, Linux and the BSDs only (`canPrintNatively`), so
 * on a Mac or a phone the entry would be a menu row whose entire job is to
 * raise an error. exportPdf asks the same question, for Ctrl+E.
 *
 * `platform` is null until Rust answers, and in a browser where there is
 * nothing to ask; that counts as available so the menu does not flicker.
 *
 * LaTeX is a third case: while LATEX_ENABLED is false the preview says so,
 * but a .tex file can still be opened — the picker still accepts one, and a
 * restored session still brings one back — so the entry has to go too.
 * Otherwise the document reads "LaTeX is disabled" and the menu still
 * offers to compile it with the engine that was disabled.
 */
export function isPdfExportAvailable(activeKind: DocKind, platform: Platform): boolean {
  return (
    (LATEX_ENABLED || activeKind !== "latex") &&
    (canPrintNatively(platform) || activeKind !== "markdown")
  );
}

/*
 * The updater is a desktop plugin and is not compiled into the mobile
 * build, so the menu entry is absent there rather than failing when
 * pressed. `platform` is null until Rust answers; treating that as
 * "not mobile" is what keeps a desktop from flickering the entry in and
 * out on startup, and matches what `isPdfExportAvailable` above does.
 *
 * It is also absent when the build has no updater configured, which is
 * every build until the signing keys exist. Without it `check()` throws on
 * the missing endpoints, and 0.1.9 shipped an entry that could only ever
 * answer with a red "could not check". Offering a control that cannot work
 * is worse than not offering it.
 */
export function isUpdateCheckAvailable(platform: Platform): boolean {
  return __UPDATER_ENABLED__ && isTauri() && !isMobilePlatform(platform);
}

/*
 * Whether this build can have recent documents at all, which decides
 * whether the menu shows the section — empty or not — or leaves it out.
 *
 * Only a real path can be reopened later, so only a real path is
 * remembered (see `recent.rs`). A browser has file handles it cannot name,
 * and Android hands the app a `content://` URI whose permission dies with
 * the process, so on both the list is not merely empty today: it can never
 * fill. Drawing "No recent documents" there would promise a door that does
 * not open.
 *
 * Null platform counts as desktop for the same reason it does above: so a
 * desktop does not flicker the section in and out while Rust answers.
 */
export function isRecentAvailable(platform: Platform): boolean {
  return isTauri() && !isMobilePlatform(platform);
}
