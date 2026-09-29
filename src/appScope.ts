import type { Dispatch, RefObject, SetStateAction } from "react";
import type { RecentEntry } from "./backend/types";
import type {
  ConfirmRequest,
  ConflictRequest,
  LayoutMode,
  RenameRequest,
} from "./components/types";
import type { EditorHandle } from "./Editor";
import type { DocumentStat } from "./externalChange";
import type { FileOperation } from "./fileOperations";
import type { NoticeAPI } from "./hooks/useNotice";
import type { Platform } from "./hooks/usePlatform";
import type { Language, TranslationFn } from "./i18n/translations";
import type { PageMetrics } from "./pageSetup";
import type { PreviewHandle } from "./Preview";
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
  // The render's state, and what App works out from it.
  t: TranslationFn;
  lang: Language;
  ready: boolean;
  docs: Doc[];
  activeId: string;
  /** The document on screen, if there is one. */
  active: Doc | undefined;
  recent: RecentEntry[];
  platform: Platform;
  coarsePointer: boolean;
  layoutMode: LayoutMode;
  zenMode: boolean;
  docView: boolean;
  presenting: boolean;
  pageMetrics: PageMetrics;
  confirmRequest: ConfirmRequest | null;
  renameRequest: RenameRequest | null;
  conflictRequest: ConflictRequest | null;
  shortcutsOpen: boolean;
  preferencesOpen: boolean;
  aboutOpen: boolean;

  // Refs, read when a command runs.
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
  closedTabsRef: RefObject<Doc[]>;
  splitRatioRef: RefObject<number>;
  editorRef: RefObject<EditorHandle | null>;
  previewRef: RefObject<PreviewHandle | null>;

  // State setters, and the callbacks App's hooks hand back.
  setDocs: Dispatch<SetStateAction<Doc[]>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setBusyOperation: Dispatch<SetStateAction<FileOperation | null>>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setZenMode: Dispatch<SetStateAction<boolean>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;
  setConflictRequest: Dispatch<SetStateAction<ConflictRequest | null>>;
  showNotice: NoticeAPI["showNotice"];
  nudgeAutosave: () => void;
  openPaths: (documents: Doc[]) => Promise<void>;
  confirmDialog: (message: string) => Promise<boolean>;
  renameDialog: (id: string, name: string) => Promise<string | null>;
  refreshRecent: () => Promise<RecentEntry[]>;
  refreshRecentAfterSave: (path: string | null | undefined) => void;
  newTab: () => void;
  newTypstTab: () => void;
  newLatexTab: () => void;
  cycleTab: (step: number) => void;
  toggleZen: () => void;
  chooseLayout: (mode: LayoutMode) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
};
