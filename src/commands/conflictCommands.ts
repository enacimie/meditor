import type { AppScope } from "../appScope";
import { isOperationBusy } from "../fileOperations";
import type { createFileCommands } from "./fileCommands";

/**
 * The three answers to a file that changed on disk under unsaved edits: take
 * the file, keep the edits, or save the edits somewhere else.
 */
export function createConflictCommands(
  scope: Pick<
    AppScope,
    | "conflictRequest"
    | "setConflictRequest"
    | "setDocs"
    | "conflictBusyRef"
    | "busyOperationRef"
    | "nudgeAutosave"
  >,
  { saveAs }: Pick<ReturnType<typeof createFileCommands>, "saveAs">,
) {
  const {
    conflictRequest,
    setConflictRequest,
    setDocs,
    conflictBusyRef,
    busyOperationRef,
    nudgeAutosave,
  } = scope;

  function resolveConflictReload() {
    if (!conflictRequest) return;
    // The modal blocked editing while it was up, so the buffer still matches
    // what the user chose to throw away.
    const { id, diskContent } = conflictRequest;
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, content: diskContent, dirty: false } : d)),
    );
    conflictBusyRef.current = false;
    setConflictRequest(null);
  }

  function resolveConflictKeep() {
    conflictBusyRef.current = false;
    setConflictRequest(null);
    // The buffer the writer has just chosen to defend is still unsaved, and
    // keeping it changes no document, so nothing else would ask for it.
    nudgeAutosave();
  }

  function resolveConflictSaveAs() {
    const req = conflictRequest;
    if (!req) return;
    /*
     * The lock before the dismissal.
     *
     * `saveAs` declines in silence while another operation holds it, and
     * this used to clear the dialog first -- so the reader's choice
     * vanished with their buffer unwritten and nothing on screen saying
     * so. Leaving the question up is the honest answer: it can be given
     * again once whatever is in the way has finished.
     */
    if (isOperationBusy(busyOperationRef)) return;
    conflictBusyRef.current = false;
    setConflictRequest(null);
    void saveAs(req.id);
  }

  return { resolveConflictReload, resolveConflictKeep, resolveConflictSaveAs };
}
