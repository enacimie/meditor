import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppScope } from "../appScope";
import { backend } from "../backend";
import { showNativeAlert } from "../fileOperations";
import type { createWriters } from "./writers";

function waitForCloseTasks(tasks: Promise<unknown>[], timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (completed: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve(completed);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    void Promise.allSettled(tasks).then((results) =>
      finish(results.every((result) => result.status === "fulfilled")),
    );
  });
}

/** Leaving the application: `requestQuit`, below. */
export function createQuit(
  scope: Pick<
    AppScope,
    | "closingRef"
    | "docsRef"
    | "activeIdRef"
    | "splitRatioRef"
    | "sessionTimerRef"
    | "saveQueueRef"
    | "sessionSaveQueueRef"
    | "closeTRef"
    | "closeLangRef"
    | "confirmDialog"
  >,
  { writeSessionOrdered }: Pick<ReturnType<typeof createWriters>, "writeSessionOrdered">,
) {
  const {
    closingRef,
    docsRef,
    activeIdRef,
    splitRatioRef,
    sessionTimerRef,
    saveQueueRef,
    sessionSaveQueueRef,
    closeTRef,
    closeLangRef,
    confirmDialog,
  } = scope;

  /**
   * Quit the app, running the same cleanup as a window close: confirm unsaved
   * changes, flush the final session, then exit through Rust. Shared by the
   * close guard and the Ctrl+Q shortcut, so both behave identically.
   */
  async function requestQuit() {
    if (!isTauri() || closingRef.current) return;
    closingRef.current = true;
    try {
      const hasDirtyDocuments = docsRef.current.some((d) => d.dirty);
      if (hasDirtyDocuments) {
        const ok = await confirmDialog(
          closeTRef.current("confirm.unsavedClose"),
        );
        if (!ok) return;
      }
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
      const finalSession = writeSessionOrdered(
        docsRef.current,
        activeIdRef.current,
        splitRatioRef.current,
      );
      const closeTasksCompleted = await waitForCloseTasks([
        saveQueueRef.current,
        finalSession,
        sessionSaveQueueRef.current,
      ]);
      if (!closeTasksCompleted) {
        // Say the loss, and leave anyway. Trapping somebody in an application
        // that refuses to close is worse than the cache that failed to
        // write: the session has a five-megabyte ceiling and the disk can be
        // full, and retrying walks into the same wall every time. The
        // documents' own saves ran ahead of this in the queue; what is lost
        // is the restore point, not silently the writing.
        await showNativeAlert(
          closeTRef.current("session.saveError"),
          closeLangRef.current,
        );
      }
      await backend.exitApp();
    } catch (error) {
      console.error("Could not close application", error);
      // Last resort: try a plain destroy. It is unreliable on WebKitGTK, but
      // works on other platforms and sometimes here.
      try {
        await getCurrentWindow().destroy();
      } catch {
        // The window stays open; the user can retry the close.
      }
    } finally {
      closingRef.current = false;
    }
  }

  return { requestQuit };
}
