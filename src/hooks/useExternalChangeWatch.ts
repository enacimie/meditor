import { useEffect, useRef } from "react";
import type { AppScope } from "../appScope";
import { backend } from "../backend";
import { classifyExternalChange, type DocumentStat } from "../externalChange";
import type { Doc } from "../types";

/**
 * The watch on open files: every file-backed document is checked for edits
 * made elsewhere once straight away and then every three seconds. A clean
 * document takes the file's new contents; one with unsaved edits raises the
 * conflict dialog.
 */
export function useExternalChangeWatch(
  scope: Pick<
    AppScope,
    | "t"
    | "lang"
    | "ready"
    | "docsRef"
    | "statsRef"
    | "watchInflightRef"
    | "busyOperationRef"
    | "conflictBusyRef"
    | "confirmBusyRef"
    | "closingRef"
    | "setDocs"
    | "setConflictRequest"
    | "showNotice"
  >,
) {
  const {
    t,
    lang,
    ready,
    docsRef,
    statsRef,
    watchInflightRef,
    busyOperationRef,
    conflictBusyRef,
    confirmBusyRef,
    closingRef,
    setDocs,
    setConflictRequest,
    showNotice,
  } = scope;

  // Latest poll routine, so the once-scheduled interval always calls the
  // current render's version (fresh docs/lang) without re-registering.
  const checkExternalChangesRef = useRef<() => Promise<void>>(async () => {});

  /*
   * Watch open files for edits made behind our back.
   *
   * Polling rather than fs events on purpose: desktop has watchers, but
   * Android's content URIs have nothing to watch — no path, no inotify — and
   * this way both worlds run exactly the same code. A tick fingerprints every
   * file-backed document (mtime + size, cheap); the file is only actually
   * read when its fingerprint moved.
   */
  useEffect(() => {
    if (!ready) return;
    /*
     * The first tick is immediate, not three seconds out.
     *
     * Autosave arms its own two-second clock the moment `ready` flips, and a
     * session restored dirty over a file that changed while meditor was
     * closed has to be classified — and the conflict lock set — before an
     * autosave is allowed anywhere near it. Polling first also means the
     * common restart case (nothing changed) costs one early fingerprint
     * sweep and nothing else.
     */
    void checkExternalChangesRef.current();
    const timer = window.setInterval(() => {
      void checkExternalChangesRef.current();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [ready]);

  /**
   * One poll tick over every file-backed document. Serialized against
   * itself, skipped while a native dialog owns the UI, a conflict modal is up
   * or a question about unsaved work is waiting to be answered, and stopped
   * at the first conflict so documents resolve one at a time.
   */
  async function checkExternalChanges() {
    if (
      watchInflightRef.current ||
      busyOperationRef.current !== null ||
      conflictBusyRef.current ||
      // A question about unsaved work is already on screen, and the conflict
      // this could raise would be about the same unsaved work: two modals,
      // each trapping the focus, and answering one changes what the other
      // was asked about. Nothing rearms this — it is an interval, so the tick
      // that stands down is followed by another one three seconds later.
      confirmBusyRef.current
    ) {
      return;
    }
    const handled = docsRef.current.filter((d) => d.handle);
    if (!handled.length) return;
    watchInflightRef.current = true;
    try {
      for (const doc of handled) {
        const live = docsRef.current.find((d) => d.id === doc.id);
        const handle = live?.handle;
        if (!live || !handle) continue;
        let stat: DocumentStat = null;
        let diskContent = "";
        try {
          stat = await backend.documentStat(handle, lang);
          const seen = statsRef.current.get(handle);
          if (
            !stat ||
            (seen &&
              seen.modifiedMs === stat.modifiedMs &&
              seen.size === stat.size)
          ) {
            continue;
          }
          diskContent = await backend.readDocument(handle, lang);
        } catch {
          // Unwatchable right now (deleted, provider gone). Deletion surfaces
          // on the next save, where it can be explained properly.
          continue;
        }
        /*
         * Read again, now that two awaits have passed.
         *
         * The guards at the top of this function were true when the tick
         * started; a file dialog, an export or a question can have opened
         * since. Raising the conflict anyway paints a second `aria-modal`
         * over the first, and answering it with "save mine elsewhere" then
         * does nothing at all -- `saveAs` declines silently while another
         * operation holds the lock, so the dialog goes away and the buffer
         * the reader chose to protect is not written.
         *
         * Nothing is lost by leaving: this is an interval, and the next
         * tick is three seconds behind.
         */
        if (
          busyOperationRef.current !== null ||
          conflictBusyRef.current ||
          confirmBusyRef.current ||
          closingRef.current
        ) {
          return;
        }
        const verdict = classifyExternalChange({
          baseline: statsRef.current.get(handle) ?? null,
          current: stat,
          diskContent,
          bufferContent: live.content,
          dirty: live.dirty,
        });
        if (verdict.action === "refresh-baseline") {
          statsRef.current.set(handle, stat);
        } else if (verdict.action === "reload") {
          applyExternalReload(live, handle, stat, verdict.diskContent);
        } else if (verdict.action === "conflict") {
          // Adopted up front so this tick stays single-shot; whichever way
          // the dialog resolves, the baseline is already correct.
          statsRef.current.set(handle, stat);
          conflictBusyRef.current = true;
          setConflictRequest({
            id: live.id,
            name: live.name,
            diskContent: verdict.diskContent,
          });
          return;
        }
      }
    } finally {
      watchInflightRef.current = false;
    }
  }
  checkExternalChangesRef.current = checkExternalChanges;

  /**
   * Silent reload of a clean document whose file moved underneath it.
   *
   * The snapshot inside the updater guards a race: if the user typed between
   * reading the disk and applying, the buffer is no longer what was judged
   * clean — drop the just-adopted fingerprint (idempotent under StrictMode's
   * double-invoke) so the next tick re-classifies against the now-dirty
   * buffer instead of clobbering the fresh keystrokes.
   */
  function applyExternalReload(
    doc: Doc,
    handle: string,
    stat: DocumentStat,
    diskContent: string,
  ) {
    statsRef.current.set(handle, stat);
    const snapshot = doc.content;
    setDocs((prev) => {
      const current = prev.find((d) => d.id === doc.id);
      if (!current || current.content !== snapshot || current.dirty) {
        statsRef.current.delete(handle);
        return prev;
      }
      return prev.map((d) =>
        d.id === doc.id ? { ...d, content: diskContent, dirty: false } : d,
      );
    });
    showNotice(t("conflict.reloadedNotice", doc.name), "info");
  }
}
