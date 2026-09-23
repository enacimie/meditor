import { useEffect, useState } from "react";
import { backend } from "../backend";

/** What the backend reports ("linux", "android", "web"), or null until it answers. */
export type Platform = string | null;

/**
 * Which platform the backend is running on.
 *
 * Asked of the backend rather than inferred from the user agent, which on
 * Android says "Linux" and would send the interface down the wrong branch.
 * Null while the answer is in flight; callers should treat that as "assume
 * the feature exists" so a desktop never flickers a menu entry in and out on
 * startup. The web backend answers "web", which no menu treats as mobile.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(null);

  useEffect(() => {
    let cancelled = false;
    backend
      .platform()
      .then((value) => {
        if (!cancelled) setPlatform(value);
      })
      .catch((error) => console.error("Could not read the platform", error));
    return () => {
      cancelled = true;
    };
  }, []);

  return platform;
}

/**
 * Whether this is a phone or a tablet.
 *
 * Distinct from `useCoarsePointer`, and both are needed: the pointer decides
 * how the interface should look, this decides what the backend can actually
 * do. A touch monitor on a desktop is coarse but not mobile.
 */
export function isMobilePlatform(platform: Platform): boolean {
  return platform === "android" || platform === "ios";
}

/*
 * Where the webview can print, which is how a Markdown document or a Marp
 * deck becomes a PDF, and what Ctrl+P does.
 *
 * The same targets `export.rs` prints under — Windows through WebView2,
 * Linux and the BSDs through WebKitGTK — plus the web build, where the
 * browser's own dialog does it. macOS has no print path yet and a phone has
 * none at all; Rust answers "not supported" there. Typst and LaTeX compile
 * their PDF in WASM and never ask.
 */
const PRINTS_NATIVELY = new Set([
  "windows",
  "linux",
  "dragonfly",
  "freebsd",
  "netbsd",
  "openbsd",
  "web",
]);

/**
 * Whether the webview can print here.
 *
 * Null — Rust has not answered yet — counts as yes, for the same reason as
 * above: a desktop must not flicker its menu entry in and out on startup.
 */
export function canPrintNatively(platform: Platform): boolean {
  return platform === null || PRINTS_NATIVELY.has(platform);
}
