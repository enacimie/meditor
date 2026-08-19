import { useEffect, useState } from "react";

/**
 * `(pointer: coarse)` — the primary pointer cannot hit small targets.
 *
 * This is the phone/tablet test, and a better one than a width breakpoint: a
 * narrow desktop window is still driven by a mouse and wants the desktop
 * behaviour, while a tablet in landscape is 1024px wide and still wants
 * fingers-first. The stylesheets ask the same question with a media query, so
 * CSS and behaviour cannot drift apart.
 */
const COARSE_POINTER = "(pointer: coarse)";

/**
 * One-shot read, for the places that need the answer before React runs —
 * choosing a default preference, say. Everything live should use the hook.
 */
export function prefersCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(COARSE_POINTER).matches;
}

/**
 * Whether the primary pointer is a finger.
 *
 * Kept live rather than read once: a tablet gains a mouse when it is docked,
 * and Chrome's device emulation flips it mid-session, which is how the E2E
 * spec exercises the touch layout without a phone.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(prefersCoarsePointer);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(COARSE_POINTER);
    const update = () => setCoarse(query.matches);
    // Re-read on mount: between the initial state and this effect the browser
    // may have settled on a different answer.
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return coarse;
}
