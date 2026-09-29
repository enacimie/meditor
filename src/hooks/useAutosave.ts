import { useEffect, useRef, useState } from "react";
import type { AppScope } from "../appScope";
import type { createWriters } from "../commands/writers";

/**
 * How long after the last edit an autosave writes.
 *
 * Long enough that a pause for thought mid-sentence does not write half a
 * word to the file, short enough that the work is on disk before the writer
 * has moved on. Two seconds is what VS Code and Typora settled on.
 */
const AUTOSAVE_DELAY_MS = 2000;

/**
 * Who autosave says it is when it puts a notice up.
 *
 * Its failure message has no timer, so somebody has to take it down, and the
 * one that does must be able to prove the message was autosave's. The update
 * check also shows a notice with no timer — "Downloading…" — and a successful
 * autosave used to clear that one too, leaving a download running with
 * nothing on screen to say so.
 */
const AUTOSAVE_NOTICE = "autosave";

/** A counter the autosave timer watches besides `docs`, and the call that bumps it. */
export function useAutosaveNudge() {
  /**
   * Ask autosave to look again.
   *
   * Its timer is armed by `docs` changing, which is the debounce and is right
   * for typing — but a pass that *declines* to run changes no document, so on
   * its own nothing would ever ask a second time. Waiting out a file dialog,
   * an export, or a conflict dialog therefore meant the edits behind it were
   * never written at all: not late, never. Answering "keep mine" to a
   * conflict was the worst of them, because the buffer the writer had just
   * chosen to defend was the one left unsaved.
   */
  const [autosaveNudge, setAutosaveNudge] = useState(0);
  const nudgeAutosave = () => setAutosaveNudge((n) => n + 1);

  return { autosaveNudge, nudgeAutosave };
}

/**
 * Autosave, while the setting is on: every dirty document that has a file,
 * written two seconds after the typing stops.
 */
export function useAutosave(
  scope: Pick<
    AppScope,
    | "t"
    | "ready"
    | "docs"
    | "editorPrefs"
    | "autosaveNudge"
    | "docsRef"
    | "busyOperationRef"
    | "conflictBusyRef"
    | "confirmBusyRef"
    | "closingRef"
    | "setDocs"
    | "showNotice"
    | "dismissNotice"
    | "refreshRecentAfterSave"
  >,
  { writeFileOrdered }: Pick<ReturnType<typeof createWriters>, "writeFileOrdered">,
) {
  const {
    t,
    ready,
    docs,
    editorPrefs,
    autosaveNudge,
    docsRef,
    busyOperationRef,
    conflictBusyRef,
    confirmBusyRef,
    closingRef,
    setDocs,
    showNotice,
    dismissNotice,
    refreshRecentAfterSave,
  } = scope;

  // "The standing notice on screen is an autosave failure", so a later write
  // that works can take it down again.
  const autosaveFailedRef = useRef(false);

  /*
   * Autosave, when it is switched on.
   *
   * Every dirty document that has a file, not just the one on screen. Saving
   * only the active tab would mean the answer to "was my work written?"
   * depended on which tab happened to be in front when the writer stopped
   * typing, which is not an answer anybody can hold in their head.
   *
   * It stays out of the way of the writer rather than competing with them:
   *
   * - `beginOperation` is deliberately not used. That guard is for the things
   *   a person starts — it puts a notice up and blocks the others — and an
   *   autosave that announced itself every two seconds would be worse than no
   *   autosave. It waits for those operations instead.
   * - Nothing is written while a conflict is on screen. The whole question
   *   there is which version wins, and answering it by writing is answering it
   *   for the writer.
   * - Success is silent. The dirty dot going out is the feedback; a "Saved"
   *   notice on a timer is noise.
   *
   * Writes go through the same ordered queue as Ctrl+S, so an autosave and a
   * manual save cannot interleave, and the queue adopts the file's new
   * fingerprint on the way out — without which the watcher would read this
   * write back as somebody else's and raise a conflict over it every couple of
   * seconds.
   */
  async function autosaveDirtyDocuments(): Promise<void> {
    if (
      busyOperationRef.current !== null ||
      conflictBusyRef.current ||
      confirmBusyRef.current ||
      // The application is on its way out. A write armed by the last
      // keystroke is still pending when "exit anyway?" is answered yes, and
      // `requestQuit` then spends up to five seconds on its close tasks
      // holding no file lock -- long enough for that write to land and put
      // on disk exactly the work the dialog said would be lost.
      closingRef.current
    ) {
      return;
    }
    let wrote = false;
    const unwritable: string[] = [];
    for (const doc of docsRef.current) {
      if (!doc.dirty || !doc.handle) continue;
      const { id, handle } = doc;
      const savedContent = doc.content;
      try {
        await writeFileOrdered(handle, savedContent);
        refreshRecentAfterSave(doc.path);
        wrote = true;
        setDocs((prev) =>
          prev.map((d) =>
            // Only if the buffer is still what was written: the writer may
            // have carried on while the write was in flight, and calling that
            // clean would lose the difference.
            d.id === id && d.content === savedContent ? { ...d, dirty: false } : d,
          ),
        );
      } catch (error) {
        /*
         * Remembered, and the pass carries on to the next document.
         *
         * It used to return here, and that was worse than it looks: the
         * documents are walked in tab order, a file that cannot be written
         * stays dirty and stays first, so the next pass died in the same
         * place — and every tab behind it went unsaved for as long as that
         * one file was read-only, with nothing on screen to say so.
         */
        console.error("autosave failed:", error);
        unwritable.push(doc.name);
      }
    }

    /*
     * Said once for the whole pass, with a name, and it stays up.
     *
     * A file that cannot be written — read-only, unplugged, gone — is worth
     * knowing about, because the writer is relying on this now and nothing
     * else is going to tell them. A modal every two seconds would be
     * unusable, and so would a notice per document; naming the first and
     * counting the rest fits the one line the notice has.
     *
     * A notice with no timer needs somebody to take it down, and success is
     * silent, so the next pass that writes everything it tried does it. Left
     * to itself this would still be claiming a file cannot be written long
     * after the drive came back.
     */
    if (unwritable.length > 0) {
      autosaveFailedRef.current = true;
      showNotice(
        t("autosave.failed", unwritable[0], unwritable.length - 1),
        "error",
        0,
        AUTOSAVE_NOTICE,
      );
    } else if (wrote && autosaveFailedRef.current) {
      autosaveFailedRef.current = false;
      // Only if what is on screen is still autosave's own message. An update
      // download puts a notice up with no timer too, and clearing that one
      // would leave a download running with nothing to show for it.
      dismissNotice(AUTOSAVE_NOTICE);
    }
  }

  useEffect(() => {
    if (!ready || !editorPrefs.autosave) return;
    // `docs` in the dependencies is the debounce: every keystroke replaces the
    // document and restarts the clock, so this fires once the typing stops
    // rather than once per edit.
    //
    // `autosaveNudge` is the other way in, for the passes that decline to run:
    // a skipped pass changes nothing, so without it nothing would ever ask
    // again. See `nudgeAutosave`.
    const timer = window.setTimeout(() => {
      void autosaveDirtyDocuments();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, editorPrefs.autosave, docs, autosaveNudge]);
}
