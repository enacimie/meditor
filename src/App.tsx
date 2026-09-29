import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { EditorHandle } from "./Editor";
import type { PreviewHandle } from "./Preview";
import PreviewPane from "./components/PreviewPane";
import type { LineRange } from "./editorSelection";
import { SAMPLE } from "./sample";
import { isMarpDocument } from "./marpDetect";
import { pdfTitle, withDocumentTitle } from "./pdfTitle";
import { pdfMetadata } from "./pdfMetadata";
import Topbar from "./components/Topbar";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import AppDialogs from "./components/AppDialogs";
import EditorPane from "./components/EditorPane";
import SplitDivider from "./components/SplitDivider";
import { useTranslation } from "./i18n/I18nProvider";
import { isRtl } from "./i18n/translations";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useSplitDivider } from "./hooks/useSplitDivider";
import { useNotice } from "./hooks/useNotice";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useZoom } from "./hooks/useZoom";
import { useCoarsePointer } from "./hooks/useCoarsePointer";
import { usePlatform, canPrintNatively } from "./hooks/usePlatform";
import { useCursorPosition } from "./hooks/useCursorPosition";
import { useAutosaveNudge } from "./hooks/useAutosave";
import { useDocumentFacts } from "./hooks/useDocumentFacts";
import { useConfirmRequest, useRenameRequest } from "./hooks/useDialogRequests";
import { useRecentDocuments } from "./hooks/useRecentDocuments";
import { useDocumentActions } from "./hooks/useDocumentActions";
import type { AppScope } from "./appScope";
import { createWriters } from "./commands/writers";
import { createOperationLock } from "./commands/operationLock";
import { createFileCommands } from "./commands/fileCommands";
import { createQuit } from "./commands/quit";
import { createConflictCommands } from "./commands/conflictCommands";
import { createExportCommands } from "./commands/exportCommands";
import { createTabCommands } from "./commands/tabCommands";
import { createNavigationCommands } from "./commands/navigationCommands";
import { createShortcutHandlers } from "./commands/shortcutHandlers";

import type { Doc } from "./types";
import type { ConflictRequest, LayoutMode, Theme } from "./components/types";
import { makeDoc, newId, normalizeDoc, seedWatchBaselines } from "./documentUtils";
import type { EditorPreferences } from "./editorPreferences";
import { loadPreferences, savePreferences } from "./appPreferences";
import {
  type FileOperation,
  showNativeAlert,
  isOperationBusy,
  operationNoticeDone,
  operationNoticeError,
  operationErrorPrefix,
} from "./fileOperations";
import {
  isPdfExportAvailable,
  isUpdateCheckAvailable,
  isRecentAvailable,
} from "./menuAvailability";
import { getTypst } from "./typstEngine";
import { prepareTypst, typstMainName } from "./typstFiles";
import { compileLatexToPdf } from "./latexEngine";
import { LATEX_ENABLED } from "./latexSupport";
import { classifyExternalChange, type DocumentStat } from "./externalChange";
import { backend } from "./backend";
import "./App.css";

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

const MAX_PENDING_OPEN_DOCS = 256;

const INITIAL_PREFERENCES = loadPreferences();

export default function App() {
  const { t, lang, setLanguage } = useTranslation();
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState("");
  const [docView, setDocView] = useState(INITIAL_PREFERENCES.docView);
  const [wrap, setWrap] = useState(INITIAL_PREFERENCES.wrap);
  const [theme, setTheme] = useState<Theme>(INITIAL_PREFERENCES.theme);
  const platform = usePlatform();
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    INITIAL_PREFERENCES.layoutMode,
  );
  const coarsePointer = useCoarsePointer();

  /*
   * Side-by-side panes need a mouse and a wide screen; a phone has neither.
   * So on a touch screen the workspace is one pane or the other, and every
   * route into `split` lands on the reader instead — the stored preference
   * from a desktop session, Ctrl+2 from an attached keyboard, and the jumps
   * between panes, which get their own treatment further down because they
   * are aiming at a particular pane rather than at both.
   */
  const chooseLayout = useCallback(
    (mode: LayoutMode) => {
      setLayoutMode(coarsePointer && mode === "split" ? "preview" : mode);
    },
    [coarsePointer],
  );

  useEffect(() => {
    if (!coarsePointer) return;
    setLayoutMode((mode) => (mode === "split" ? "preview" : mode));
  }, [coarsePointer]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [compactLayout, setCompactLayout] = useState(false);
  const [busyOperation, setBusyOperation] = useState<FileOperation | null>(null);
  const [conflictRequest, setConflictRequest] = useState<ConflictRequest | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [editorPrefs, setEditorPrefs] = useState<EditorPreferences>({
    editorFontSize: INITIAL_PREFERENCES.editorFontSize,
    editorFontFamily: INITIAL_PREFERENCES.editorFontFamily,
    spellcheck: INITIAL_PREFERENCES.spellcheck,
    landscapeTables: INITIAL_PREFERENCES.landscapeTables,
    focusMode: INITIAL_PREFERENCES.focusMode,
    typewriterMode: INITIAL_PREFERENCES.typewriterMode,
    paperSize: INITIAL_PREFERENCES.paperSize,
    autosave: INITIAL_PREFERENCES.autosave,
    pageMarginMm: INITIAL_PREFERENCES.pageMarginMm,
  });
  const { cursorLine, cursorColumn, onCursorMoved } = useCursorPosition();

  // Extracted hooks
  useThemeEffect(theme);
  const { split, setSplit, dragging, splitRef, splitRatioRef, onDividerDown, onDividerMove, onDividerUp } =
    useSplitDivider(50);
  const { notice, showNotice, dismissNotice } = useNotice();
  const updates = useUpdateCheck(t, { showNotice, dismissNotice });
  const { zoom, zoomIn, zoomOut, zoomReset } = useZoom();

  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  // What is selected in the editor, marked in the preview. Handed straight
  // across rather than through state: nothing else here needs to redraw for it.
  const onSelectionLines = useCallback((lines: LineRange | null) => {
    previewRef.current?.showEditorSelection(lines);
  }, []);
  const docsRef = useRef<Doc[]>([]);
  const idsRef = useRef<string[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionTimerRef = useRef<number | undefined>(undefined);
  const activeIdRef = useRef("");
  const pendingOpenDocsRef = useRef<Doc[]>([]);
  const closingRef = useRef(false);
  const busyOperationRef = useRef<FileOperation | null>(null);
  // Latest translation function, read by the (once-registered) close guard.
  const closeTRef = useRef(t);
  closeTRef.current = t;
  const closeLangRef = useRef(lang);
  closeLangRef.current = lang;
  // Ensures the close guard is registered exactly once (StrictMode's dev
  // double-mount must not leave duplicate listeners that re-swallow closes).
  // The resolved value is never used; the promise only acts as a guard.
  const closeGuardRef = useRef<Promise<unknown> | null>(null);
  // Latest quit routine, so the once-registered close guard and Ctrl+Q both
  // run the same flow without capturing a stale render.
  const requestQuitRef = useRef<() => Promise<void>>(async () => {});
  // Most recently closed tabs, so Ctrl+Shift+T can bring them back.
  const closedTabsRef = useRef<Doc[]>([]);
  // External-change watch: last seen fingerprint per registry handle, a poll
  // guard, and a flag for "the conflict modal is up" (cleared on resolution).
  const statsRef = useRef<Map<string, DocumentStat>>(new Map());
  const watchInflightRef = useRef(false);
  const conflictBusyRef = useRef(false);
  // "The standing notice on screen is an autosave failure", so a later write
  // that works can take it down again.
  const autosaveFailedRef = useRef(false);
  const { autosaveNudge, nudgeAutosave } = useAutosaveNudge();
  // Latest poll routine, so the once-scheduled interval always calls the
  // current render's version (fresh docs/lang) without re-registering.
  const checkExternalChangesRef = useRef<() => Promise<void>>(async () => {});
  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  activeIdRef.current = activeId;
  const {
    activeContent,
    activeKind,
    headings,
    markdownSyncAvailable,
    isActiveMarp,
    docLanguage,
    pageMetrics,
  } = useDocumentFacts(active, outlineOpen, editorPrefs);
  const { confirmRequest, confirmBusyRef, confirmDialog, answerConfirm } =
    useConfirmRequest(nudgeAutosave);
  const { renameRequest, setRenameRequest, renameDialog } = useRenameRequest();
  const { recent, refreshRecent, refreshRecentAfterSave } = useRecentDocuments();
  const { openPaths, updateContent, newTab, newTypstTab, newLatexTab, newMarpTab, cycleTab } =
    useDocumentActions({
      docsRef,
      activeIdRef,
      busyOperationRef,
      statsRef,
      setDocs,
      setActiveId,
    });

  const toggleZen = useCallback(() => {
    setZenMode((z) => !z);
  }, []);

  const startPresent = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    setPresenting(true);
  }, []);

  const exitPresent = useCallback(() => {
    setPresenting(false);
  }, []);

  /*
   * What the commands read, as this render has it. A plain object, made
   * afresh on every render and never memoised or changed: each factory below
   * destructures its part before declaring its functions, so every command
   * still closes over the values of the render that made it.
   */
  const scope: AppScope = {
    t,
    lang,
    ready,
    docs,
    activeId,
    active,
    recent,
    platform,
    coarsePointer,
    layoutMode,
    zenMode,
    docView,
    presenting,
    pageMetrics,
    confirmRequest,
    renameRequest,
    conflictRequest,
    shortcutsOpen,
    preferencesOpen,
    aboutOpen,
    docsRef,
    activeIdRef,
    statsRef,
    saveQueueRef,
    sessionSaveQueueRef,
    sessionTimerRef,
    closingRef,
    busyOperationRef,
    pendingOpenDocsRef,
    closeTRef,
    closeLangRef,
    conflictBusyRef,
    closedTabsRef,
    splitRatioRef,
    editorRef,
    previewRef,
    setDocs,
    setActiveId,
    setBusyOperation,
    setLayoutMode,
    setZenMode,
    setMenuOpen,
    setShortcutsOpen,
    setPreferencesOpen,
    setConflictRequest,
    showNotice,
    nudgeAutosave,
    openPaths,
    confirmDialog,
    renameDialog,
    refreshRecent,
    refreshRecentAfterSave,
    newTab,
    newTypstTab,
    newLatexTab,
    cycleTab,
    toggleZen,
    chooseLayout,
    zoomIn,
    zoomOut,
    zoomReset,
  };
  const { adoptOwnWrite, writeFileOrdered, writeSessionOrdered } = createWriters(scope);
  const { beginOperation, endOperation } = createOperationLock(scope);
  const { openRecent, reloadFromDisk, openFiles, saveAs, save } = createFileCommands(scope, {
    beginOperation,
    endOperation,
    adoptOwnWrite,
    writeFileOrdered,
  });
  const { requestQuit } = createQuit(scope, { writeSessionOrdered });
  requestQuitRef.current = requestQuit;
  const { resolveConflictReload, resolveConflictKeep, resolveConflictSaveAs } =
    createConflictCommands(scope, { saveAs });
  const { printDocument, exportHtml } = createExportCommands(scope, {
    beginOperation,
    endOperation,
  });
  const { closeTab, closeAllTabs, closeOtherTabs, reopenTab, renameTab } =
    createTabCommands(scope);
  const {
    handleReverseSync,
    handleForwardSync,
    handleReverseSyncButton,
    toggleTask,
    findInDocument,
    findPanelReachable,
  } = createNavigationCommands(scope);
  const shortcutHandlers = createShortcutHandlers(scope, {
    save,
    saveAs,
    openFiles,
    exportPdf,
    printDocument,
    closeTab,
    reopenTab,
    renameTab,
    requestQuit,
    findInDocument,
    findPanelReachable,
  });

  // Switching away from the deck (another tab, or the front-matter removed)
  // leaves nothing to present, so drop out of the overlay instead of letting
  // it silently reappear on the way back.
  useEffect(() => {
    if (presenting && !isActiveMarp) setPresenting(false);
  }, [presenting, isActiveMarp]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let base: Doc[] = [];
      let startActive = "";
      let cliDocs: Doc[] = [];
      // Both backends answer these: Rust reads its session file, the web
      // backend localStorage; an empty result means "start with the sample".
      try {
        cliDocs = (await backend.cliFiles(lang)).map(normalizeDoc);
      } catch {
        cliDocs = [];
      }
      try {
        const restored = await backend.loadSession(lang);
        if (restored) {
          base = restored.docs.map(normalizeDoc);
          startActive = restored.activeId;
          splitRatioRef.current = restored.split;
        }
      } catch (error) {
        console.warn("Could not restore session", error);
        base = [];
      }
      if (!base.length) {
        const d = makeDoc(SAMPLE, base);
        base = [d];
        startActive = d.id;
      }
      let cliActive = "";
      for (const incoming of cliDocs) {
        const ex = base.find((d) => d.path === incoming.path);
        if (ex) {
          if (!cliActive) cliActive = ex.id;
          continue;
        }
        base.push({ ...normalizeDoc(incoming), id: newId() });
        if (!cliActive) cliActive = base[base.length - 1].id;
      }
      if (cancelled) return;
      if (cliActive) startActive = cliActive;
      seedWatchBaselines(statsRef.current, base);
      setDocs(base);
      if (!startActive || !base.some((d) => d.id === startActive)) {
        startActive = base[0]?.id ?? "";
      }
      setActiveId(startActive);
      setSplit(splitRatioRef.current);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  // Startup should run once; language is read from the render that starts it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSplit, splitRatioRef]);

  useLayoutEffect(() => {
    docsRef.current = docs;
    const newIds = docs.map((d) => d.id);
    const same = idsRef.current.length === newIds.length && 
      idsRef.current.every((id, i) => id === newIds[i]);
    if (!same) idsRef.current = newIds;
  }, [docs]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<Doc[]>("open-documents", (e) => {
      if (busyOperationRef.current !== null) {
        pendingOpenDocsRef.current.push(...e.payload);
        if (pendingOpenDocsRef.current.length > MAX_PENDING_OPEN_DOCS) {
          pendingOpenDocsRef.current.splice(
            0,
            pendingOpenDocsRef.current.length - MAX_PENDING_OPEN_DOCS,
          );
          console.warn("Dropped stale external opens due to queue overflow");
        }
      } else {
        void openPaths(e.payload);
      }
    }).then((f) => {
      if (cancelled) f();
      else unlisten = f;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openPaths]);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    if (!closeGuardRef.current) {
      // The guard runs the cleanup (dirty confirm + final session save) while
      // the window is kept open via preventDefault, then finishes by exiting
      // the whole app through Rust. We cannot rely on window.close()/
      // destroy() here: on Linux/WebKitGTK, once this JS listener is
      // registered, Tauri auto-prevent_close()s the request and the JS
      // destroy() does not tear the window down (first click is swallowed).
      closeGuardRef.current = win
        .onCloseRequested(async (e) => {
          e.preventDefault();
          await requestQuitRef.current();
        })
        .catch(() => {
          // Registration failed (IPC error): allow a future render to retry.
          closeGuardRef.current = null;
        });
    }
    return () => {
      // Intentionally keep the close guard registered for the app's lifetime.
      // Re-registering on re-renders (or on StrictMode's dev double-mount,
      // where the async unlisten cannot be applied during the synchronous
      // cleanup) previously left zero or duplicate listeners that swallowed
      // the first close request or skipped the final session save.
    };
  }, []);

  /*
   * Write the session out the moment the app stops being visible.
   *
   * The close guard below covers a window being closed, and the debounce
   * above covers ordinary typing — but Android fires neither. The system
   * freezes the WebView when you switch away and may kill the process later
   * without running anything else, so a pending debounce simply never lands
   * and the last edits are gone.
   *
   * `visibilitychange` is the last moment anything is guaranteed to run, so
   * the debounce is collapsed into an immediate write there. `pagehide`
   * catches the cases visibility does not: a reload, a tab closing.
   *
   * Desktop gets the same treatment, where it is a small win rather than a
   * necessity — minimising or switching workspaces now checkpoints the
   * session instead of leaving it to the timer.
   */
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
      writeSessionOrdered(
        docsRef.current,
        activeIdRef.current,
        splitRatioRef.current,
      ).catch((error) => console.error("Could not save session", error));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, splitRatioRef]);

  useEffect(() => {
    /*
     * Every backend, not only the desktop's. This writer used to be gated
     * on `isTauri()`, which left the web build checkpointing only on
     * `visibilitychange`/`pagehide` — a browser that crashes, or a tab the
     * OS kills in the background, took the whole session with it, silently.
     * The comment on the flush below has always claimed the debounce covers
     * ordinary typing; now that is true on the web too.
     */
    if (!ready) return;
    if (sessionTimerRef.current !== undefined) {
      window.clearTimeout(sessionTimerRef.current);
    }
    sessionTimerRef.current = window.setTimeout(() => {
      sessionTimerRef.current = undefined;
      writeSessionOrdered(docs, activeId, splitRatioRef.current).catch((error) =>
        console.error("Could not save session", error),
      );
    }, 500);
    return () => {
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
    };
  // The writer is intentionally recreated with the current locale; this
  // effect is scheduled only by document/session state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, activeId, ready, splitRatioRef]);

  useEffect(() => {
    document.title = active?.name ?? "meditor";
  }, [active?.name]);

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



  useEffect(() => {
    if (!ready) return;
    savePreferences({ docView, wrap, theme, layoutMode, ...editorPrefs });
  }, [docView, wrap, theme, layoutMode, editorPrefs, ready]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

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

  async function exportPdf() {
    // Both backends export: the desktop prints the webview to a file, and the
    // web build hands the page to the browser's own dialog or downloads the
    // PDF a WASM engine produced. Asking `isTauri()` here left the web build's
    // menu entry doing nothing at all.
    if (!active) return;
    // Hiding the menu entry is not enough: Ctrl+E comes here directly. A
    // Markdown document, a Marp deck included, reaches PDF only through the
    // webview's printing, which a Mac or a phone does not have; say so rather
    // than hand Rust a request it can only refuse.
    if (active.kind === "markdown" && !canPrintNatively(platform)) {
      showNotice(t("op.pdfUnavailableHere"), "info");
      return;
    }
    if (!beginOperation("export")) return;
    try {
      const base = active.name.replace(/\.(md|markdown|txt|typ|typst|tex|latex|ltx)$/i, "") || t("doc.defaultExport");
      if (active.kind === "typst") {
        // Typst: compile to PDF in the Typst worker, the one the preview
        // uses, with the files beside the document as the preview had them,
        // then save through the backend.
        const { $typst } = await getTypst();
        const { input } = await prepareTypst(
          active.content,
          typstMainName(active.path),
          active.handle ? { handle: active.handle, locale: lang } : undefined,
        );
        const pdfBytes = await $typst.pdf(input);
        if (!pdfBytes) throw new Error("Typst compilation produced no output");
        const defaultName = `${base}.pdf`;
        await backend.writePdfBytes(pdfBytes, defaultName, lang);
      } else if (active.kind === "latex") {
        // Hiding the menu entry is not enough: Ctrl+E reaches this directly,
        // without passing through the menu. Without this guard the shortcut
        // would still hand the document to the very engine that was switched
        // off — and that engine's package endpoint is the reason it was.
        if (!LATEX_ENABLED) throw new Error(t("preview.latexDisabled"));
        // LaTeX: compile to PDF via SwiftLaTeX WASM, then save via Tauri dialog.
        const pdfBytes = await compileLatexToPdf(active.content);
        if (!pdfBytes) throw new Error("LaTeX compilation produced no output");
        const defaultName = `${base}.pdf`;
        await backend.writePdfBytes(pdfBytes, defaultName, lang);
      } else if (isMarpDocument(active.content)) {
        // Marp: one slide per page, and that page is the slide itself. Read the
        // real size from the rendered viewBox rather than assuming 16:9, since
        // a `size` directive or theme can change it.
        const { renderMarp } = await import("./marpEngine");
        const { html } = renderMarp(active.content);
        const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(html);
        const widthIn = viewBox ? Number(viewBox[1]) / 96 : 1280 / 96;
        const heightIn = viewBox ? Number(viewBox[2]) / 96 : 720 / 96;
        // Here and below, the PDF takes its title from `document.title` as it
        // prints: the document's own, when its front-matter names one, rather
        // than the tab's. The author, subject and keywords, which no engine
        // writes, go to the backend to add afterwards.
        await withDocumentTitle(pdfTitle(active), () =>
          backend.exportPdf(
            `${base}.pdf`,
            lang,
            true,
            widthIn,
            heightIn,
            undefined,
            pdfMetadata(active),
          ),
        );
      } else {
        await withDocumentTitle(pdfTitle(active), () =>
          backend.exportPdf(
            `${base}.pdf`,
            lang,
            // The paginated preview already draws its pages with their own
            // margins; asking the printer for margins too would inset every
            // page a second time and split it across two sheets.
            docView,
            undefined,
            undefined,
            // And the sheet it drew them on, which the printer has to agree
            // with or every page spills onto the next.
            pageMetrics.paper.id,
            pdfMetadata(active),
          ),
        );
      }
      showNotice(operationNoticeDone(t, "export"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "export"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "export") + String(e), lang);
    } finally {
      endOperation("export");
    }
  }

  // Keyboard shortcuts — extracted to its own hook
  useKeyboardShortcuts(ready, shortcutHandlers);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="splash-logo">meditor</div>
          <div className="splash-bar">
            <div className="splash-bar-fill" />
          </div>
          <div className="splash-hint">{t("app.loading")}</div>
        </div>
      </div>
    );
  }

  const pdfExportAvailable = isPdfExportAvailable(activeKind, platform);
  const updateCheckAvailable = isUpdateCheckAvailable(platform);
  const recentAvailable = isRecentAvailable(platform);

  /*
   * Pane sizing is decided here rather than left to the stylesheet. The divider
   * ratio only means anything while both panes share the workspace; the rest of
   * the time the visible pane takes all of it.
   *
   * It is written inline in both cases on purpose. Leaving the ratio in place
   * and overriding it from CSS put `flex: 1 1 100% !important` up against an
   * inline `flex: 0 0 50%`, and the Windows and macOS CI runners did not
   * reliably resolve that the way the cascade says they should — the pane kept
   * half the width with dead space beside it. Removing the attribute instead
   * left a narrower version of the same race. An inline value that is simply
   * correct for the current mode has neither problem.
   */
  const sharingTheWorkspace = layoutMode === "split" && !zenMode;
  const paneFlex = (percent: number) =>
    sharingTheWorkspace ? `0 0 ${percent}%` : "1 1 100%";

  return (
    <div
      className={
        "app" +
        (zenMode ? " zen" : "") +
        // Split is the default, so it needs no class of its own.
        (layoutMode !== "split" ? ` layout-${layoutMode}` : "")
      }
    >
      <Topbar
        t={t}
        lang={lang}
        setLanguage={setLanguage}
        notice={notice}
        busyOperation={busyOperation}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        theme={theme}
        setTheme={setTheme}
        zenMode={zenMode}
        onToggleZen={toggleZen}
        onNew={newTab}
        onNewTypst={newTypstTab}
        onNewLatex={newLatexTab}
        onNewMarp={newMarpTab}
        onPresent={isActiveMarp && !presenting ? startPresent : undefined}
        onOpen={openFiles}
        onSave={save}
        onSaveAs={saveAs}
        // Only where there is a file to read back. The recent rows are gated
        // the same way, and for the same reason: a row that cannot do
        // anything teaches nothing by being there.
        onReload={active?.handle ? reloadFromDisk : undefined}
        recent={recent}
        onOpenRecent={recentAvailable ? openRecent : undefined}
        onExportPdf={pdfExportAvailable ? exportPdf : undefined}
        onExportHtml={active?.kind === "markdown" ? exportHtml : undefined}
        onCloseAll={closeAllTabs}
        onCloseOthers={closeOtherTabs}
        onAbout={() => setAboutOpen(true)}
        onCheckUpdates={updateCheckAvailable ? updates.checkForUpdates : undefined}
        onPreferences={() => setPreferencesOpen(true)}
        layoutMode={layoutMode}
        onLayoutModeChange={chooseLayout}
        onFind={findInDocument}
        coarsePointer={coarsePointer}
      />
      {zenMode && (
        <button
          type="button"
          className="zen-exit"
          onClick={() => setZenMode(false)}
          aria-label={t("menu.zenExit")}
          title={`${t("menu.zenExit")} (F11 / Esc)`}
        >
          <span aria-hidden="true">×</span>
          <span>{t("menu.zenExit")}</span>
        </button>
      )}
      <TabBar
        t={t}
        docs={docs}
        activeId={activeId}
        busyOperation={busyOperation}
        rtl={isRtl(lang)}
        onSelectTab={setActiveId}
        onCloseTab={closeTab}
        onRenameTab={renameTab}
        onNewTab={newTab}
      />
      <div
        id="workspace-panels"
        className={"split" + (dragging ? " dragging" : "")}
        ref={splitRef}
        role="tabpanel"
        aria-labelledby={active ? `tab-${active.id}` : undefined}
        aria-label={active?.name ?? ""}
        tabIndex={-1}
      >
        <EditorPane
          t={t}
          flex={paneFlex(split)}
          markdownSyncAvailable={markdownSyncAvailable}
          handleForwardSync={handleForwardSync}
          coarsePointer={coarsePointer}
          editorRef={editorRef}
          wrap={wrap}
          setWrap={setWrap}
          outlineOpen={outlineOpen}
          setOutlineOpen={setOutlineOpen}
          headings={headings}
          cursorLine={cursorLine}
          activeId={activeId}
          ids={idsRef.current}
          active={active}
          updateContent={updateContent}
          editorPrefs={editorPrefs}
          zenMode={zenMode}
          lang={lang}
          docLanguage={docLanguage}
          onCursorMoved={onCursorMoved}
          onSelectionLines={onSelectionLines}
          showNotice={showNotice}
        />
        <SplitDivider
          t={t}
          compactLayout={compactLayout}
          split={split}
          setSplit={setSplit}
          splitRatioRef={splitRatioRef}
          onDividerDown={onDividerDown}
          onDividerMove={onDividerMove}
          onDividerUp={onDividerUp}
        />
        <PreviewPane
          t={t}
          flex={paneFlex(100 - split)}
          markdownSyncAvailable={markdownSyncAvailable}
          handleReverseSyncButton={handleReverseSyncButton}
          active={active}
          isActiveMarp={isActiveMarp}
          docView={docView}
          setDocView={setDocView}
          previewRef={previewRef}
          editorPrefs={editorPrefs}
          pageMetrics={pageMetrics}
          docLanguage={docLanguage}
          theme={theme}
          toggleTask={toggleTask}
          handleReverseSync={handleReverseSync}
        />
      </div>
      <StatusBar
        t={t}
        content={active?.content ?? ""}
        docName={active?.name}
        dirty={active?.dirty}
        cursorLine={cursorLine + 1}
        cursorColumn={cursorColumn}
        zoom={zoom}
        onZoomReset={zoomReset}
      />
      <AppDialogs
        t={t}
        confirmRequest={confirmRequest}
        answerConfirm={answerConfirm}
        updates={updates}
        conflictRequest={conflictRequest}
        renameRequest={renameRequest}
        resolveConflictReload={resolveConflictReload}
        resolveConflictKeep={resolveConflictKeep}
        resolveConflictSaveAs={resolveConflictSaveAs}
        setRenameRequest={setRenameRequest}
        preferencesOpen={preferencesOpen}
        setPreferencesOpen={setPreferencesOpen}
        aboutOpen={aboutOpen}
        setAboutOpen={setAboutOpen}
        shortcutsOpen={shortcutsOpen}
        setShortcutsOpen={setShortcutsOpen}
        editorPrefs={editorPrefs}
        setEditorPrefs={setEditorPrefs}
        presenting={presenting}
        isActiveMarp={isActiveMarp}
        activeContent={activeContent}
        exitPresent={exitPresent}
      />
    </div>
  );
}
