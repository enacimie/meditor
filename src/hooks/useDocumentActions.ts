import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { makeDoc, newId, normalizeDoc, seedWatchBaselines } from "../documentUtils";
import type { DocumentStat } from "../externalChange";
import { isOperationBusy, type FileOperation } from "../fileOperations";
import { TYPST_SAMPLE, LATEX_SAMPLE, MARP_SAMPLE } from "../sample";
import type { Doc } from "../types";

type DocumentActionsArgs = {
  docsRef: RefObject<Doc[]>;
  activeIdRef: RefObject<string>;
  busyOperationRef: RefObject<FileOperation | null>;
  statsRef: RefObject<Map<string, DocumentStat>>;
  setDocs: Dispatch<SetStateAction<Doc[]>>;
  setActiveId: Dispatch<SetStateAction<string>>;
};

/**
 * What changes the list of open documents without asking anybody anything:
 * files arriving, typing into the active one, a new tab of each kind, and
 * stepping between tabs. Every callback keeps its identity for good.
 */
export function useDocumentActions({
  docsRef,
  activeIdRef,
  busyOperationRef,
  statsRef,
  setDocs,
  setActiveId,
}: DocumentActionsArgs) {
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());

  const mergeDocuments = useCallback((incoming: Doc[]): void => {
    if (!incoming.length) return;
    const next = [...docsRef.current];
    let activateId = "";
    for (const incomingDoc of incoming) {
      const ex = next.find((d) => d.path === incomingDoc.path);
      if (ex) {
        if (!activateId) activateId = ex.id;
        continue;
      }
      const doc = { ...normalizeDoc(incomingDoc), id: newId() };
      next.push(doc);
      if (!activateId) activateId = doc.id;
    }
    // Whatever the backend handed over carries the file's fingerprint with
    // it; the watch has to start from there, or a writer who types inside
    // the first poll interval is accused of conflicting with the file they
    // just opened.
    seedWatchBaselines(statsRef.current, incoming);
    docsRef.current = next;
    setDocs(next);
    if (activateId) setActiveId(activateId);
  }, [docsRef, statsRef, setDocs, setActiveId]);

  const openPaths = useCallback((documents: Doc[]): Promise<void> => {
    const next = openQueueRef.current.then(() => {
      mergeDocuments(documents);
    });
    openQueueRef.current = next.catch(() => undefined);
    return next;
  }, [mergeDocuments]);

  const updateContent = useCallback((content: string) => {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === activeIdRef.current && d.content !== content
          ? { ...d, content, dirty: true }
          : d,
      ),
    );
  }, [activeIdRef, setDocs]);

  const newTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc("", docsRef.current);
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, [busyOperationRef, docsRef, setDocs, setActiveId]);

  const newTypstTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc(TYPST_SAMPLE, docsRef.current, null, undefined, "typst");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, [busyOperationRef, docsRef, setDocs, setActiveId]);

  const newLatexTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc(LATEX_SAMPLE, docsRef.current, null, undefined, "latex");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, [busyOperationRef, docsRef, setDocs, setActiveId]);

  const newMarpTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    // A Marp deck is Markdown that opts in via front-matter, so the kind stays
    // "markdown"; the preview detects the opt-in and renders slides.
    const doc = makeDoc(MARP_SAMPLE, docsRef.current, null, undefined, "markdown");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, [busyOperationRef, docsRef, setDocs, setActiveId]);

  /** Move `step` tabs from the active one, wrapping around like the tab bar. */
  const cycleTab = useCallback((step: number) => {
    const list = docsRef.current;
    if (list.length < 2) return;
    const current = list.findIndex((d) => d.id === activeIdRef.current);
    if (current === -1) return;
    const next = (current + step + list.length) % list.length;
    setActiveId(list[next].id);
  }, [docsRef, activeIdRef, setActiveId]);

  return { openPaths, updateContent, newTab, newTypstTab, newLatexTab, newMarpTab, cycleTab };
}
