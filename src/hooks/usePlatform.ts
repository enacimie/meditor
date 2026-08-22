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
