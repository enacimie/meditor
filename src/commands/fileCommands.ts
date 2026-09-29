import type { AppScope } from "../appScope";
import { backend } from "../backend";
import { normalizeDoc } from "../documentUtils";
import {
  showNativeAlert,
  operationNoticeDone,
  operationNoticeError,
  operationErrorPrefix,
} from "../fileOperations";
import type { createOperationLock } from "./operationLock";
import type { createWriters } from "./writers";

type Siblings = ReturnType<typeof createOperationLock> &
  Pick<ReturnType<typeof createWriters>, "adoptOwnWrite" | "writeFileOrdered">;

/**
 * The file commands a person starts: open a recent document, reload one from
 * its file, open files, save as, and save.
 */
export function createFileCommands(
  scope: Pick<
    AppScope,
    | "t"
    | "lang"
    | "active"
    | "recent"
    | "docsRef"
    | "statsRef"
    | "conflictBusyRef"
    | "setDocs"
    | "showNotice"
    | "openPaths"
    | "confirmDialog"
    | "refreshRecent"
    | "refreshRecentAfterSave"
  >,
  { beginOperation, endOperation, adoptOwnWrite, writeFileOrdered }: Siblings,
) {
  const {
    t,
    lang,
    active,
    recent,
    docsRef,
    statsRef,
    conflictBusyRef,
    setDocs,
    showNotice,
    openPaths,
    confirmDialog,
    refreshRecent,
    refreshRecentAfterSave,
  } = scope;

  /**
   * Open the nth remembered document.
   *
   * Both ways this can fail end in the same place, because to the person who
   * clicked they are the same thing: the document is not there any more. The
   * backend answers with nothing when the position has gone, and throws when
   * the file has; either way the refreshed list no longer carries that entry,
   * because reading it prunes what is missing.
   *
   * Which is worth checking rather than guessing, because the alternative
   * message is bad: a file deleted since the menu was drawn fails inside
   * `std::fs`, and what reaches the writer is the operating system's own
   * words for it, in English, in a modal — "The system cannot find the file
   * specified. (os error 2)". A permission error or a file grown too large
   * still gets that route, and should: those are worth the details. A file
   * that is simply gone is not.
   */
  async function openRecent(index: number) {
    if (!beginOperation("open")) return;
    // Captured before anything can refresh the list underneath it: this is
    // the row the writer clicked, whatever the list says afterwards.
    const clicked = recent[index];
    try {
      const payload = await backend.openRecent(index, lang);
      if (!payload) {
        /*
         * Nothing to open: either the position went away between the menu
         * being drawn and the click, or the file itself has. The backend
         * answers the same way for both, and to the person who clicked they
         * are the same event — the row they aimed at is not there.
         *
         * It used to be decided here instead, by re-reading the list and
         * seeing whether the entry survived the pruning. That read every
         * failure as an absence: a file on a disconnected share or one whose
         * permissions changed is pruned too, and the writer was told it "is
         * no longer where it was" while the real reason went in the console.
         */
        await refreshRecent();
        showNotice(
          clicked ? t("menu.recentGone", clicked.name) : t("op.cancelled"),
          "info",
        );
        return;
      }
      const opened = normalizeDoc(payload);
      await openPaths([opened]);
      await refreshRecent();
      showNotice(t("op.filesOpened", 1), "success");
    } catch (error) {
      // Everything that reaches here is a file that is present and would not
      // open — locked, unreadable, too large — and for those the details are
      // the whole of the help.
      await refreshRecent();
      showNotice(operationNoticeError(t, "open"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "open") + String(error), lang);
    } finally {
      endOperation("open");
    }
  }

  /**
   * Read the document's file again and take what is there.
   *
   * The watch already does this on its own when it notices a file move, and
   * that covers the ordinary case. This is for the times it cannot: a file
   * whose fingerprint did not move although its bytes did — some editors
   * preserve the modification time — or a reader who simply wants to be sure
   * they are looking at what is on disk rather than trusting a poll. Every
   * editor of this kind has the command; meditor did not, and the button
   * people found instead was "Check for updates".
   *
   * Unsaved work is never thrown away without being asked, because that is
   * exactly what this does: the file wins, whole.
   */
  async function reloadFromDisk() {
    const target = active;
    const handle = target?.handle;
    if (!target || !handle) return;
    /*
     * The lock goes on before the question, not after the answer.
     *
     * Autosave writes two seconds after the last edit and stands down only
     * while an operation is in flight. Ask first and it lands while the
     * dialog is still on screen: the buffer this command exists to throw
     * away becomes the file, and the "Yes" reads it straight back. The
     * command would report having reloaded the document, having in fact
     * overwritten the file with the very thing the writer asked to discard.
     *
     * Holding it across the question is also what `openFiles` does while the
     * file dialog is up, cancellation included.
     */
    if (!beginOperation("reload")) return;
    try {
      if (target.dirty) {
        const ok = await confirmDialog(t("confirm.reloadDiscards", target.name));
        if (!ok) {
          // Replaces the persistent "Reloading…" that `beginOperation` put up.
          showNotice(t("op.cancelled"), "info");
          return;
        }
      }
      const content = await backend.readDocument(handle, lang);
      /*
       * The fingerprint too, and before the buffer is replaced.
       *
       * Without it the next poll finds a file whose fingerprint has moved
       * since the baseline and reads it all over again — harmless, but it
       * would also classify: a document made clean here would simply be
       * reloaded a second time, and one the writer starts typing into within
       * three seconds would raise a conflict over the very reload they asked
       * for.
       */
      const stat = await backend.documentStat(handle, lang);
      if (stat) statsRef.current.set(handle, stat);
      const id = target.id;
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, content, dirty: false } : d)));
      showNotice(t("op.reloaded", target.name), "success");
    } catch (error) {
      showNotice(operationNoticeError(t, "reload"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "reload") + String(error), lang);
    } finally {
      endOperation("reload");
    }
  }

  async function openFiles() {
    if (!beginOperation("open")) return;
    try {
      const opened = (await backend.openFiles(lang)).map(normalizeDoc);
      if (opened.length) {
        await openPaths(opened);
        await refreshRecent();
        showNotice(
          t("op.filesOpened", opened.length),
          "success",
        );
      } else {
        showNotice(t("op.cancelled"), "info");
      }
    } catch (error) {
      showNotice(operationNoticeError(t, "open"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "open") + String(error), lang);
    } finally {
      endOperation("open");
    }
  }

  async function saveAs(targetId?: string) {
    // Same lock as save(): while the conflict dialog is up, the only route
    // to a write is the dialog's own "Save As", which clears the lock first.
    if (conflictBusyRef.current) return;
    // The conflict dialog routes a background tab here, so the target is
    // resolved by id when given; the menu and Ctrl+Shift+S keep saving the
    // active document.
    const target = targetId ? docsRef.current.find((d) => d.id === targetId) : active;
    if (!target || !beginOperation("saveAs")) return;
    const documentId = target.id;
    const savedContent = target.content;
    const ext =
      target.kind === "typst" ? ".typ" : target.kind === "latex" ? ".tex" : ".md";
    const base = target.name.replace(/\.(md|markdown|txt|typ|typst|tex|latex|ltx)$/i, "");
    const defaultName = `${base}${ext}`;
    try {
      const savedPayload = await backend.saveAs(savedContent, defaultName, lang);
      if (!savedPayload) {
        showNotice(t("op.cancelled"), "info");
        return;
      }
      const saved = normalizeDoc(savedPayload);
      /*
       * The same adoption Ctrl+S does, for the same reason.
       *
       * The file is new to the watcher, so without this its first poll finds
       * no baseline for the handle, reads the disk, and compares it to the
       * buffer. Type anything in the seconds after choosing a name and the
       * two differ with the document dirty — which the watcher calls a
       * conflict, and puts a "changed on disk" dialog in front of a file the
       * writer created a moment ago.
       *
       * Awaited inside the operation, so it is settled before `endOperation`
       * lets the poll run at all.
       */
      // Nothing to pass: the file dialog wrote this one, so there is no
      // fingerprint travelling back with it and the stat has to be asked for.
      if (saved.handle) await adoptOwnWrite(saved.handle, null);
      void refreshRecent();
      setDocs((prev) =>
        prev.map((d) =>
          d.id === documentId
            ? {
                ...d,
                path: saved.path,
                name: saved.name,
                handle: saved.handle,
                kind: saved.kind,
                dirty: d.content === savedContent ? false : d.dirty,
              }
            : d,
        ),
      );
      showNotice(operationNoticeDone(t, "saveAs"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "saveAs"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "saveAs") + String(e), lang);
    } finally {
      endOperation("saveAs");
    }
  }

  async function save() {
    if (!active) return;
    // The conflict dialog is a question about this very file, and a
    // shortcut must not answer behind its back: Ctrl+S reaches this
    // function with the dialog up (the global key handler knows nothing of
    // it), and a write from here would make the dialog's later "Reload from
    // disk" install stale content over the save nobody sees. The dialog's
    // own buttons clear the lock before they route anywhere.
    if (conflictBusyRef.current) return;
    if (!active.handle) {
      await saveAs();
      return;
    }
    if (!beginOperation("save")) return;
    try {
      const savedContent = active.content;
      await writeFileOrdered(active.handle, savedContent);
      refreshRecentAfterSave(active.path);
      const id = active.id;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === id && d.content === savedContent ? { ...d, dirty: false } : d,
        ),
      );
      showNotice(operationNoticeDone(t, "save"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "save"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "save") + String(e), lang);
    } finally {
      endOperation("save");
    }
  }

  return { openRecent, reloadFromDisk, openFiles, saveAs, save };
}
