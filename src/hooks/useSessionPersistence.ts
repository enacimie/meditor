import { useEffect } from "react";
import type { AppScope } from "../appScope";
import type { createWriters } from "../commands/writers";

/**
 * Keeping the session on disk: written half a second after the documents or
 * the active tab change, and at once when the application stops being
 * visible.
 */
export function useSessionPersistence(
  scope: Pick<
    AppScope,
    "ready" | "docs" | "activeId" | "docsRef" | "activeIdRef" | "splitRatioRef" | "sessionTimerRef"
  >,
  writeSessionOrdered: ReturnType<typeof createWriters>["writeSessionOrdered"],
) {
  const { ready, docs, activeId, docsRef, activeIdRef, splitRatioRef, sessionTimerRef } = scope;

  /*
   * Write the session out the moment the app stops being visible.
   *
   * The close guard covers a window being closed, and the debounced write
   * below covers ordinary typing — but Android fires neither. The system
   * freezes the WebView when you switch away and may kill the process later
   * without running anything else, so a pending debounce simply never lands
   * and the last edits are gone.
   *
   * `visibilitychange` is the last moment anything is guaranteed to run, so
   * the debounce is collapsed into an immediate write there. `pagehide`
   * catches the cases visibility does not: a reload, a tab closing.
   *
   * Desktop gets the same treatment, where it is a small win rather than a
   * necessity — minimising or switching workspaces now checkpoints the
   * session instead of leaving it to the timer.
   */
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
      writeSessionOrdered(
        docsRef.current,
        activeIdRef.current,
        splitRatioRef.current,
      ).catch((error) => console.error("Could not save session", error));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, splitRatioRef]);

  useEffect(() => {
    /*
     * Every backend, not only the desktop's. This writer used to be gated
     * on `isTauri()`, which left the web build checkpointing only on
     * `visibilitychange`/`pagehide` — a browser that crashes, or a tab the
     * OS kills in the background, took the whole session with it, silently.
     * The comment on the flush above has always claimed the debounce covers
     * ordinary typing; now that is true on the web too.
     */
    if (!ready) return;
    if (sessionTimerRef.current !== undefined) {
      window.clearTimeout(sessionTimerRef.current);
    }
    sessionTimerRef.current = window.setTimeout(() => {
      sessionTimerRef.current = undefined;
      writeSessionOrdered(docs, activeId, splitRatioRef.current).catch((error) =>
        console.error("Could not save session", error),
      );
    }, 500);
    return () => {
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
    };
  // The writer is intentionally recreated with the current locale; this
  // effect is scheduled only by document/session state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, activeId, ready, splitRatioRef]);
}
