import type { AppScope } from "../appScope";
import { backend } from "../backend";
import type { DocumentStat } from "../externalChange";
import type { Doc } from "../types";

/**
 * The writes that wait their turn: a document's file, and the session. Each
 * goes through its own queue, so two of a kind never interleave.
 */
export function createWriters(
  scope: Pick<AppScope, "lang" | "statsRef" | "saveQueueRef" | "sessionSaveQueueRef">,
) {
  const { lang, statsRef, saveQueueRef, sessionSaveQueueRef } = scope;

  /**
   * Adopt the fingerprint of a file this application has just written.
   *
   * Without this, saving looks exactly like somebody else editing the file.
   * The write moves the mtime, so the next poll reads the disk and compares it
   * to the buffer — and if the writer typed anything in between, the two
   * differ and the document is dirty again, which the watcher calls a conflict
   * and puts a dialog in front of a change this application made itself.
   *
   * Rare with Ctrl+S, which needs the writer to type inside the three-second
   * poll window. Constant with an autosave.
   *
   * The fingerprint comes back from the write itself, taken beside it rather
   * than fetched afterwards. Asking for it in a second call left a window in
   * which another process could write the same file: its fingerprint would be
   * adopted as ours, and the watcher would then believe the disk matched a
   * buffer it no longer does — silently, and until the file moved again.
   *
   * `stat` is null only where a backend cannot answer at all, and there the
   * fallback is what this used to do all the time.
   */
  async function adoptOwnWrite(handle: string, stat: DocumentStat): Promise<void> {
    if (stat) {
      statsRef.current.set(handle, stat);
      return;
    }
    try {
      const fetched = await backend.documentStat(handle, lang);
      if (fetched) statsRef.current.set(handle, fetched);
    } catch {
      // A fingerprint that cannot be read back is a missed nicety, not a
      // failed save. The next poll will treat the file as changed and, since
      // the bytes match, adopt it quietly anyway.
    }
  }

  function writeFileOrdered(handle: string, content: string): Promise<void> {
    const next = saveQueueRef.current
      .then(() => backend.saveDocument(handle, content, lang))
      .then((stat) => adoptOwnWrite(handle, stat));
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }

  function writeSessionOrdered(
    documents: Doc[],
    currentActiveId: string,
    ratio: number,
  ): Promise<void> {
    const next = sessionSaveQueueRef.current.then(() =>
      backend.saveSession(
        {
          docs: documents.map(({ id, name, path, content, dirty, handle, kind }) => ({
            id,
            name,
            path,
            content,
            dirty,
            handle: handle ?? null,
            kind,
            /*
             * The file as the watch last saw it, not as the document was born.
             *
             * This is what a restart needs to tell two identical-looking
             * situations apart: a buffer that differs from its file because
             * the writer had unsaved work, which comes back quietly, and one
             * that differs because something else wrote the file while
             * meditor was closed, which has to be reloaded or asked about.
             * Without it the next launch can only guess, and it used to guess
             * by dropping the file altogether.
             */
            stat: handle ? (statsRef.current.get(handle) ?? null) : null,
          })),
          activeId: currentActiveId,
          split: ratio,
        },
        lang,
      ),
    );
    sessionSaveQueueRef.current = next.catch(() => undefined);
    return next;
  }

  return { adoptOwnWrite, writeFileOrdered, writeSessionOrdered };
}
