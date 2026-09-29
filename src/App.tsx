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

import type { Doc } from "./types";
import type { ConflictRequest, LayoutMode, Theme } from "./components/types";
import { makeDoc, newId, normalizeDoc, seedWatchBaselines } from "./documentUtils";
import type { EditorPreferences } from "./editorPreferences";
import { loadPreferences, savePreferences } from "./appPreferences";
import {
  type FileOperation,
  showNativeAlert,
  isOperationBusy,
  operationNotice,
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

function waitForCloseTasks(tasks: Promise<unknown>[], timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (completed: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve(completed);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    void Promise.allSettled(tasks).then((results) =>
      finish(results.every((result) => result.status === "fulfilled")),
    );
  });
}

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

  /**
   * Quit the app, running the same cleanup as a window close: confirm unsaved
   * changes, flush the final session, then exit through Rust. Shared by the
   * close guard and the Ctrl+Q shortcut, so both behave identically.
   */
  async function requestQuit() {
    if (!isTauri() || closingRef.current) return;
    closingRef.current = true;
    try {
      const hasDirtyDocuments = docsRef.current.some((d) => d.dirty);
      if (hasDirtyDocuments) {
        const ok = await confirmDialog(
          closeTRef.current("confirm.unsavedClose"),
        );
        if (!ok) return;
      }
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
      const finalSession = writeSessionOrdered(
        docsRef.current,
        activeIdRef.current,
        splitRatioRef.current,
      );
      const closeTasksCompleted = await waitForCloseTasks([
        saveQueueRef.current,
        finalSession,
        sessionSaveQueueRef.current,
      ]);
      if (!closeTasksCompleted) {
        // Say the loss, and leave anyway. Trapping somebody in an application
        // that refuses to close is worse than the cache that failed to
        // write: the session has a five-megabyte ceiling and the disk can be
        // full, and retrying walks into the same wall every time. The
        // documents' own saves ran ahead of this in the queue; what is lost
        // is the restore point, not silently the writing.
        await showNativeAlert(
          closeTRef.current("session.saveError"),
          closeLangRef.current,
        );
      }
      await backend.exitApp();
    } catch (error) {
      console.error("Could not close application", error);
      // Last resort: try a plain destroy. It is unreliable on WebKitGTK, but
      // works on other platforms and sometimes here.
      try {
        await getCurrentWindow().destroy();
      } catch {
        // The window stays open; the user can retry the close.
      }
    } finally {
      closingRef.current = false;
    }
  }
  requestQuitRef.current = requestQuit;

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

  async function printDocument() {
    // Ctrl+P is the only way here, and where the webview cannot print it
    // would only pass on Rust's refusal.
    if (!canPrintNatively(platform)) {
      showNotice(t("op.printUnavailableHere"), "info");
      return;
    }
    try {
      // A Marp deck is a stack of slides, each already its own page; the
      // paginated view draws pages with their own margins. Either way the
      // printer must not inset them a second time.
      const paged = docView || (!!active && isMarpDocument(active.content));
      /*
       * The paper only for the documents this application lays out.
       *
       * `pageMetrics` describes the Document view's sheet, and a Typst or
       * LaTeX document is not on it: those compose their own page, from their
       * own `#set page` or `geometry`, and the preview shows what the engine
       * produced. Handing the printer a paper the document never chose is how
       * a Typst file written for A4 came to be printed on Letter — 17 mm
       * shorter, so every page spilled onto a second. On Linux, at least;
       * Windows shows its own dialog and ignores what it is told here, which
       * is why this went unnoticed.
       */
      const paper = (active?.kind ?? "markdown") === "markdown" ? pageMetrics.paper.id : undefined;
      await backend.printDocument(lang, paged, paper);
    } catch (e) {
      await showNativeAlert(String(e), lang);
    }
  }

  async function exportHtml() {
    // Markdown only: Typst and LaTeX render through their own engines, which
    // produce PDF rather than the HTML the preview builds.
    if (!active || active.kind !== "markdown") return;
    if (!beginOperation("exportHtml")) return;
    try {
      const base =
        active.name.replace(/\.(md|markdown|txt)$/i, "") || t("doc.defaultExport");
      // A Marp deck exports as stacked slides; anything else as a document.
      const html = isMarpDocument(active.content)
        ? await (
            await import("./exportMarpHtml")
          ).exportMarpToHtml(active.content, {
            fileName: base,
            lang,
            rtl: isRtl(lang),
            t,
          })
        : await (
            await import("./exportHtml")
          ).exportMarkdownToHtml(active.content, {
            fileName: base,
            lang,
            rtl: isRtl(lang),
            t,
            docHandle: active.handle ?? null,
            metrics: pageMetrics,
          });
      const saved = await backend.writeHtmlFile(html, `${base}.html`, lang);
      // Cancelling the save dialog is not a failure, but it is not a success
      // either: announcing "HTML exported" with no file is worse than silence.
      if (saved) showNotice(operationNoticeDone(t, "exportHtml"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "exportHtml"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "exportHtml") + String(e), lang);
    } finally {
      endOperation("exportHtml");
    }
  }

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

  /**
   * The layout that brings `pane` into view.
   *
   * On a desktop that is the split, which keeps the pane you were in. A touch
   * screen has no split to fall back on, so the jump has to hand the whole
   * workspace to the pane it is aiming at — otherwise "go to code" from the
   * reader would go nowhere at all.
   */
  function revealing(pane: "editor" | "preview"): LayoutMode {
    return coarsePointer ? pane : "split";
  }

  /**
   * Jump to a line of the source, bringing the editor back if it is hidden.
   *
   * In preview-only mode the editor is display:none, so CodeMirror cannot
   * measure anything: the scroll has to wait for the layout to come back,
   * hence the frame. scrollToLine() ends in view.focus(), so the reader lands
   * ready to type.
   */
  function goToCode(line: number) {
    if (layoutMode === "preview") {
      setLayoutMode(revealing("editor"));
      requestAnimationFrame(() => editorRef.current?.scrollToLine(line));
      return;
    }
    editorRef.current?.scrollToLine(line);
  }

  function handleReverseSync(line: number) {
    /*
     * Only a mouse means this. A tap is how you read on a phone, and turning
     * every tap into "jump to the source" would throw the reader into the
     * editor — with the on-screen keyboard over half the screen — for touching
     * the paragraph they were reading. The mark still lands, so the "go to
     * code" button in the header has somewhere to go.
     */
    if (coarsePointer) return;
    goToCode(line);
  }

  /*
   * Mirror of goToCode. Both panes offer a jump to the other one, and both
   * bring that pane back when it is off screen — otherwise the button in the
   * solo layouts would point at something the user cannot see.
   *
   * The preview needs more care than the editor: while its pane is hidden its
   * rendering is deferred, so right after the switch it holds nothing to
   * scroll to. It remembers the request and applies it once it has rendered.
   */
  function goToPreview(line: number) {
    if (layoutMode === "editor") {
      setLayoutMode(revealing("preview"));
      requestAnimationFrame(() => previewRef.current?.scrollToLine(line));
      return;
    }
    previewRef.current?.scrollToLine(line);
  }

  function handleForwardSync() {
    goToPreview(editorRef.current?.getCursorLine() ?? 0);
  }

  function handleReverseSyncButton() {
    const line = previewRef.current?.getTargetLine() ?? 0;
    goToCode(line);
  }

  /**
   * Tick a task off from the preview.
   *
   * Handed straight to the editor, which owns the text. Going through
   * `updateContent` would work and be shorter, but a whole-document update
   * rebuilds the `EditorState`, and losing the undo history because you
   * ticked a box is a worse bug than the one this fixes.
   */
  function toggleTask(line: number) {
    editorRef.current?.toggleTask(line);
  }

  /**
   * Open the find panel, bringing the editor back if it is hidden.
   *
   * Picking Find from the menu, or pressing Ctrl+F, the key that menu entry
   * shows, is an explicit request, so it takes the reader to the source
   * instead of quietly failing.
   *
   * Zen mode always shows the editor, whatever layout it will return to, so
   * there is nothing to reveal there; switching the layout would only change
   * what the reader finds on leaving it.
   */
  function findInDocument() {
    if (!ready) return;
    if (layoutMode === "preview" && !zenMode) {
      setLayoutMode(revealing("editor"));
      requestAnimationFrame(() => editorRef.current?.focusSearch());
      return;
    }
    editorRef.current?.focusSearch();
  }

  /**
   * Whether a shortcut may move focus into the find panel.
   *
   * Ctrl+F puts the caret in a field that is already on screen rather than
   * opening something of its own, so it must not take it from another field
   * (LanguagePicker search, rename dialog) or open the panel behind a modal
   * dialog.
   */
  function findPanelReachable() {
    if (!ready) return false;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return false;
    }
    if (confirmRequest || renameRequest || shortcutsOpen) return false;
    if (preferencesOpen || aboutOpen) return false;
    return true;
  }

  // Keyboard shortcuts — extracted to its own hook
  useKeyboardShortcuts(ready, {
    save,
    saveAs,
    openFiles,
    newTab,
    newTypst: newTypstTab,
    newLatex: newLatexTab,
    exportPdf,
    print: printDocument,
    closeTab: () => closeTab(activeId),
    reopenTab,
    quit: requestQuit,
    toggleZen,
    rename: () => renameTab(activeId),
    // Open-only on purpose: closing always routes through the overlay's
    // animated path (Esc/backdrop/✕). Toggling off here would unmount the
    // overlay directly and skip the exit transition. Guarded with `ready` so
    // F1 during the splash screen cannot queue an overlay to pop on mount.
    openShortcuts: () => {
      if (!ready || shortcutsOpen) return;
      setShortcutsOpen(true);
    },
    find: () => {
      if (!findPanelReachable()) return;
      // A slideshow covers the whole window: the panel would open behind it
      // and take the keys the presentation is listening for.
      if (presenting) return;
      // The menu's own Find entry closes the menu; its shortcut does too.
      setMenuOpen(false);
      findInDocument();
    },
    setLayout: chooseLayout,
    zoomIn,
    zoomOut,
    zoomReset,
    openPreferences: () => {
      if (!ready || confirmRequest || renameRequest) return;
      // Two aria-modal dialogs at once would trap focus in the wrong one.
      if (shortcutsOpen || aboutOpen) return;
      setPreferencesOpen(true);
    },
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    exitZen: () => {
      if (zenMode) setZenMode(false);
    },
  });

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
