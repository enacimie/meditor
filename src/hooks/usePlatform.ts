import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** What `std::env::consts::OS` reports, plus null until the answer arrives. */
export type Platform = string | null;

/**
 * Which operating system the backend is running on.
 *
 * Asked of Rust rather than inferred from the user agent, which on Android
 * says "Linux" and would send the interface down the wrong branch. Null while
 * the answer is in flight, and in a plain browser where there is no backend
 * to ask — callers should treat that as "assume the feature exists" so a
 * desktop never flickers a menu entry in and out on startup.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    invoke<string>("platform")
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
