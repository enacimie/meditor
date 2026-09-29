import type { AppScope } from "../appScope";
import { isOperationBusy, operationNotice, type FileOperation } from "../fileOperations";

/**
 * The lock the file operations share: one at a time, with a notice up while
 * it is held. Letting go asks autosave to look again and opens whatever
 * arrived in the meantime.
 */
export function createOperationLock(
  scope: Pick<
    AppScope,
    | "t"
    | "busyOperationRef"
    | "setBusyOperation"
    | "showNotice"
    | "nudgeAutosave"
    | "pendingOpenDocsRef"
    | "openPaths"
  >,
) {
  const {
    t,
    busyOperationRef,
    setBusyOperation,
    showNotice,
    nudgeAutosave,
    pendingOpenDocsRef,
    openPaths,
  } = scope;

  function beginOperation(operation: FileOperation): boolean {
    if (isOperationBusy(busyOperationRef)) return false;
    busyOperationRef.current = operation;
    setBusyOperation(operation);
    showNotice(operationNotice(t, operation), "info", 0);
    return true;
  }

  function endOperation(operation: FileOperation): void {
    if (busyOperationRef.current !== operation) return;
    busyOperationRef.current = null;
    setBusyOperation(null);
    // Whatever was in the way has gone, so anything autosave declined to
    // write while it was there can be asked for again.
    nudgeAutosave();
    const pending = pendingOpenDocsRef.current.splice(0);
    if (pending.length) void openPaths(pending);
  }

  return { beginOperation, endOperation };
}
