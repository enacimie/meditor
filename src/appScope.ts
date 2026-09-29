import type { Dispatch, RefObject, SetStateAction } from "react";
import type { RecentEntry } from "./backend/types";
import type { DocumentStat } from "./externalChange";
import type { FileOperation } from "./fileOperations";
import type { NoticeAPI } from "./hooks/useNotice";
import type { Language, TranslationFn } from "./i18n/translations";
import type { Doc } from "./types";

/**
 * What the commands App builds read: the state, refs and callbacks they used
 * to reach as locals of App.
 *
 * App makes one on every render, as a plain object literal, and never
 * memoises or changes it. A command factory takes the part it needs and
 * destructures it before declaring its functions, so each command closes over
 * the values of the render that made it, as it did when it was declared in
 * App.
 */
export type AppScope = {
  t: TranslationFn;
  lang: Language;
  /** The document on screen, if there is one. */
  active: Doc | undefined;
  recent: RecentEntry[];

  docsRef: RefObject<Doc[]>;
  activeIdRef: RefObject<string>;
  statsRef: RefObject<Map<string, DocumentStat>>;
  saveQueueRef: RefObject<Promise<void>>;
  sessionSaveQueueRef: RefObject<Promise<void>>;
  sessionTimerRef: RefObject<number | undefined>;
  closingRef: RefObject<boolean>;
  busyOperationRef: RefObject<FileOperation | null>;
  pendingOpenDocsRef: RefObject<Doc[]>;
  closeTRef: RefObject<TranslationFn>;
  closeLangRef: RefObject<Language>;
  conflictBusyRef: RefObject<boolean>;
  splitRatioRef: RefObject<number>;

  setDocs: Dispatch<SetStateAction<Doc[]>>;
  setBusyOperation: Dispatch<SetStateAction<FileOperation | null>>;
  showNotice: NoticeAPI["showNotice"];
  nudgeAutosave: () => void;
  openPaths: (documents: Doc[]) => Promise<void>;
  confirmDialog: (message: string) => Promise<boolean>;
  refreshRecent: () => Promise<RecentEntry[]>;
  refreshRecentAfterSave: (path: string | null | undefined) => void;
};
