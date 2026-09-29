import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Closing the window goes the same way out as Ctrl+Q, through `requestQuit`:
 * the guard is registered once, and calls the routine of the latest render.
 */
export function useCloseGuard(requestQuit: () => Promise<void>) {
  // Ensures the close guard is registered exactly once (StrictMode's dev
  // double-mount must not leave duplicate listeners that re-swallow closes).
  // The resolved value is never used; the promise only acts as a guard.
  const closeGuardRef = useRef<Promise<unknown> | null>(null);
  // Latest quit routine, so the once-registered close guard and Ctrl+Q both
  // run the same flow without capturing a stale render.
  const requestQuitRef = useRef<() => Promise<void>>(async () => {});
  requestQuitRef.current = requestQuit;

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    if (!closeGuardRef.current) {
      // The guard runs the cleanup (dirty confirm + final session save) while
      // the window is kept open via preventDefault, then finishes by exiting
      // the whole app through Rust. We cannot rely on window.close()/
      // destroy() here: on Linux/WebKitGTK, once this JS listener is
      // registered, Tauri auto-prevent_close()s the request and the JS
      // destroy() does not tear the window down (first click is swallowed).
      closeGuardRef.current = win
        .onCloseRequested(async (e) => {
          e.preventDefault();
          await requestQuitRef.current();
        })
        .catch(() => {
          // Registration failed (IPC error): allow a future render to retry.
          closeGuardRef.current = null;
        });
    }
    return () => {
      // Intentionally keep the close guard registered for the app's lifetime.
      // Re-registering on re-renders (or on StrictMode's dev double-mount,
      // where the async unlisten cannot be applied during the synchronous
      // cleanup) previously left zero or duplicate listeners that swallowed
      // the first close request or skipped the final session save.
    };
  }, []);
}
