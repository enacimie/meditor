import type { AppScope } from "../appScope";
import { makeDoc } from "../documentUtils";
import { isOperationBusy } from "../fileOperations";

/**
 * Closing tabs — one, all of them, or all but the one on screen — bringing
 * back the last one closed, and renaming.
 */
export function createTabCommands(
  scope: Pick<
    AppScope,
    | "t"
    | "docs"
    | "renameRequest"
    | "docsRef"
    | "activeIdRef"
    | "busyOperationRef"
    | "closedTabsRef"
    | "setDocs"
    | "setActiveId"
    | "confirmDialog"
    | "renameDialog"
  >,
) {
  const {
    t,
    docs,
    renameRequest,
    docsRef,
    activeIdRef,
    busyOperationRef,
    closedTabsRef,
    setDocs,
    setActiveId,
    confirmDialog,
    renameDialog,
  } = scope;

  async function closeTab(id: string) {
    if (isOperationBusy(busyOperationRef)) return;
    const initial = docsRef.current.find((d) => d.id === id);
    if (!initial) return;
    if (initial.dirty) {
      const ok = await confirmDialog(t("confirm.unsavedTab", initial.name));
      if (!ok) return;
    }
    const current = docsRef.current;
    const idx = current.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const removed = current[idx];
    const next = current.filter((d) => d.id !== id);
    closedTabsRef.current = [...closedTabsRef.current, removed];
    if (next.length === 0) {
      const fresh = makeDoc("", []);
      docsRef.current = [fresh];
      setDocs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    docsRef.current = next;
    setDocs(next);
    if (id === activeIdRef.current) {
      setActiveId(next[Math.max(0, idx - 1)].id);
    }
  }

  async function closeAllTabs() {
    if (isOperationBusy(busyOperationRef)) return;
    const hasDirty = docsRef.current.some((d) => d.dirty);
    if (hasDirty) {
      const ok = await confirmDialog(t("confirm.unsavedClose"));
      if (!ok) return;
    }
    const removed = docsRef.current;
    if (removed.length) {
      closedTabsRef.current = [...closedTabsRef.current, ...removed];
    }
    const fresh = makeDoc("", []);
    docsRef.current = [fresh];
    setDocs([fresh]);
    setActiveId(fresh.id);
  }

  async function closeOtherTabs() {
    if (isOperationBusy(busyOperationRef)) return;
    const current = docsRef.current;
    if (current.length <= 1) return;
    const others = current.filter((d) => d.id !== activeIdRef.current);
    const hasDirty = others.some((d) => d.dirty);
    if (hasDirty) {
      const ok = await confirmDialog(t("confirm.unsavedClose"));
      if (!ok) return;
    }
    const kept = current.filter((d) => d.id === activeIdRef.current);
    const removed = current.filter((d) => d.id !== activeIdRef.current);
    if (removed.length) {
      closedTabsRef.current = [...closedTabsRef.current, ...removed];
    }
    if (kept.length === 0) {
      const fresh = makeDoc("", []);
      docsRef.current = [fresh];
      setDocs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    docsRef.current = kept;
    setDocs(kept);
  }

  function reopenTab() {
    const stack = closedTabsRef.current;
    if (stack.length === 0) return;
    const doc = stack[stack.length - 1];
    closedTabsRef.current = stack.slice(0, -1);
    const current = docsRef.current;
    // Replace the empty untitled tab that closeTab/closeAllTabs leave behind
    // when nothing else is open, instead of piling a duplicate next to it.
    const placeholder =
      current.length === 1 &&
      current[0].path === null &&
      current[0].content === "" &&
      !current[0].dirty;
    const next = placeholder ? [doc] : [...current, doc];
    docsRef.current = next;
    setDocs(next);
    setActiveId(doc.id);
  }

  async function renameTab(id: string) {
    const current = docs.find((d) => d.id === id);
    if (!current || renameRequest) return;
    const name = await renameDialog(id, current.name);
    if (name) {
      setDocs((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name } : d)),
      );
    }
  }

  return { closeTab, closeAllTabs, closeOtherTabs, reopenTab, renameTab };
}
