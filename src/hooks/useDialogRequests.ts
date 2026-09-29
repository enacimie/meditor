import { useCallback, useRef, useState } from "react";
import type { ConfirmRequest, RenameRequest } from "../components/types";

/**
 * The yes-or-no question on screen: asking it, answering it, and the flag
 * that tells the timers a question about unsaved work is up.
 *
 * `nudgeAutosave` is called with every answer; see `answerConfirm`.
 */
export function useConfirmRequest(nudgeAutosave: () => void) {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  /**
   * "A question about unsaved work is on screen."
   *
   * Every "close anyway?" states an outcome — these changes are not on disk,
   * and going ahead loses them. Autosave writes two seconds after the last
   * edit and opening a dialog changes no document, so the timer that was
   * already running keeps running: a pass lands while the question is up, the
   * edits become the file, and the writer who answered "close anyway" keeps
   * them after all. The dialog said one thing and another happened.
   *
   * The external-change watch reads it too, for a milder reason: no work is
   * lost, but its conflict modal would land on top of the question, about the
   * same unsaved work, and answering one would change what the other was
   * asked about.
   *
   * A ref rather than the `confirmRequest` state because both readers are
   * timer callbacks, holding the closure from the render their effect last
   * ran on — and neither effect lists the dialog among its dependencies.
   */
  const confirmBusyRef = useRef(false);
  /**
   * The answer the question on screen is still waiting for.
   *
   * A ref and not the `confirmRequest` state: `confirmDialog` is a stable
   * callback with no dependencies, so it cannot read state as it is now —
   * and a question being replaced has to be answered from outside the
   * render that put it up.
   */
  const pendingConfirmRef = useRef<((ok: boolean) => void) | null>(null);
  const confirmSeqRef = useRef(0);

  // In-window confirmation (replaces the native GTK/system dialog). Stable
  // identity so the once-registered close guard can reference it safely.
  const confirmDialog = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      /*
       * One question at a time, and a new one supersedes the old.
       *
       * Only one request can be on screen, so asking a second thing used to
       * drop the first `resolve` and leave its `await` pending for ever.
       * That was survivable while no caller held anything across the
       * question. `reloadFromDisk` holds the file lock across it, and a lock
       * released in a `finally` that never runs takes autosave, the
       * external-change watch and every file command down with it, silently,
       * for the rest of the session — reachable with one Ctrl+Q, since
       * neither the shortcut nor the window's close guard asks whether
       * something is already being asked.
       *
       * The one being replaced is answered "no": the safe answer, and the
       * one that sends its caller down a cancel path it already has.
       */
      pendingConfirmRef.current?.(false);
      // The single place every "are you sure?" passes through, which is why
      // the flag is raised here rather than in each of the four callers.
      confirmBusyRef.current = true;
      pendingConfirmRef.current = resolve;
      confirmSeqRef.current += 1;
      setConfirmRequest({ seq: confirmSeqRef.current, message, resolve });
    });
  }, []);

  /**
   * Hand back the answer and put the application back in motion.
   *
   * One function for both buttons so that lowering the flag and asking for
   * the autosave pass that stood down cannot be done on one branch and
   * forgotten on the other.
   *
   * The nudge is not decoration. The autosave effect rearms when `docs`
   * changes, and answering a question changes no document: after a "no" the
   * tab is still dirty, still open, and nothing else would ever ask for it
   * again — the document would go unsaved until the next keystroke. That is
   * the same hole a skipped pass left behind a file dialog, and it is the
   * half of this that rots quietly.
   */
  function answerConfirm(answer: boolean): void {
    confirmBusyRef.current = false;
    // Through the ref rather than the captured state: this is the one
    // resolver still owed an answer, whichever render put it there.
    const resolve = pendingConfirmRef.current;
    pendingConfirmRef.current = null;
    setConfirmRequest(null);
    resolve?.(answer);
    nudgeAutosave();
  }

  return { confirmRequest, confirmBusyRef, confirmDialog, answerConfirm };
}

/** The tab rename on screen, and the call that asks for one. */
export function useRenameRequest() {
  const [renameRequest, setRenameRequest] = useState<RenameRequest | null>(null);

  // In-window rename dialog (replaces the native window.prompt).
  const renameDialog = useCallback(
    (id: string, name: string): Promise<string | null> => {
      return new Promise((resolve) => {
        setRenameRequest({ id, name, resolve });
      });
    },
    [],
  );

  return { renameRequest, setRenameRequest, renameDialog };
}
