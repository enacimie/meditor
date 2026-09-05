import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { EditorHandle } from "./Editor";

const Editor = lazy(() => import("./Editor"));
import Preview, { type PreviewHandle } from "./Preview";
import { SAMPLE, TYPST_SAMPLE, LATEX_SAMPLE, MARP_SAMPLE } from "./sample";
import { isMarpDocument } from "./marpDetect";
import Topbar from "./components/Topbar";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import ConfirmDialog from "./components/ConfirmDialog";
import ConflictDialog from "./components/ConflictDialog";
import RenameDialog from "./components/RenameDialog";
import ShortcutsOverlay from "./components/ShortcutsOverlay";
import AboutDialog from "./components/AboutDialog";
const PreferencesDialog = lazy(() => import("./components/PreferencesDialog"));
const PresentOverlay = lazy(() => import("./components/PresentOverlay"));
import Outline from "./components/Outline";
import { parseHeadings, type Heading } from "./components/outlineUtils";
import { useTranslation } from "./i18n/I18nProvider";
import { isRtl } from "./i18n/translations";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useSplitDivider } from "./hooks/useSplitDivider";
import { useNotice } from "./hooks/useNotice";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useCoarsePointer, prefersCoarsePointer } from "./hooks/useCoarsePointer";
import { usePlatform, isMobilePlatform } from "./hooks/usePlatform";

import type { Doc, DocKind } from "./types";
import type { LayoutMode, Theme } from "./components/types";
import { kindFromPath, nextUntitledName, normalizeDoc } from "./documentUtils";
import {
  clampFontSize,
  normalizeFontFamily,
  normalizeSpellcheck,
  normalizeLandscapeTables,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_SPELLCHECK,
  DEFAULT_LANDSCAPE_TABLES,
  DEFAULT_EDITOR_FONT_SIZE,
  type EditorPreferences,
} from "./editorPreferences";
import { getTypst } from "./typstEngine";
import { compileLatexToPdf } from "./latexEngine";
import { LATEX_ENABLED } from "./latexSupport";
import { classifyExternalChange, type DocumentStat } from "./externalChange";
import { backend } from "./backend";
import "./App.css";

type FileOperation = "open" | "save" | "saveAs" | "export" | "exportHtml";

// Editor/preview preferences. The interface language is NOT part of this
// object: I18nProvider owns it (meditor.language.v1, with all 20 languages
// validated) so there is a single source of truth for the locale.
type Preferences = {
  docView: boolean;
  wrap: boolean;
  theme: Theme;
  layoutMode: LayoutMode;
} & EditorPreferences;

const PREFERENCES_KEY = "meditor.preferences.v1";
const DEFAULT_PREFERENCES: Preferences = {
  docView: true,
  wrap: true,
  theme: "system",
  layoutMode: "split",
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
  spellcheck: DEFAULT_SPELLCHECK,
  landscapeTables: DEFAULT_LANDSCAPE_TABLES,
};
/**
 * Whether a first run should open in the paginated A4 view.
 *
 * On a desktop, yes — it is the nicer way to read a document. On a phone it is
 * the wrong answer twice over: an A4 page is 794px wide and a phone is not, so
 * it arrives either shrunk past legibility or needing sideways scrolling to
 * read a line. Only the default moves; a choice made explicitly, on either
 * kind of device, is what gets stored and what comes back.
 */
function defaultDocView(): boolean {
  return !prefersCoarsePointer();
}

const MAX_PENDING_OPEN_DOCS = 256;
/** Stable empty list, so a closed outline does not re-render its consumers. */
const EMPTY_HEADINGS: Heading[] = [];

function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES, docView: defaultDocView() };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
    const stored = value as Partial<Preferences>;
    const theme =
      stored.theme === "light" ||
      stored.theme === "dark" ||
      stored.theme === "system" ||
      stored.theme === "contrast"
        ? stored.theme
        : DEFAULT_PREFERENCES.theme;
    const layoutMode =
      stored.layoutMode === "editor" ||
      stored.layoutMode === "split" ||
      stored.layoutMode === "preview"
        ? stored.layoutMode
        : DEFAULT_PREFERENCES.layoutMode;
    return {
      docView: typeof stored.docView === "boolean" ? stored.docView : defaultDocView(),
      wrap: typeof stored.wrap === "boolean" ? stored.wrap : DEFAULT_PREFERENCES.wrap,
      theme,
      layoutMode,
      // Clamped/whitelisted: a stale or hand-edited value must not break the
      // editor, only fall back to the default.
      editorFontSize: clampFontSize(stored.editorFontSize),
      editorFontFamily: normalizeFontFamily(stored.editorFontFamily),
      spellcheck: normalizeSpellcheck(stored.spellcheck),
      landscapeTables: normalizeLandscapeTables(stored.landscapeTables),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(preferences: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be disabled or unavailable in a WebView.
  }
}

async function showNativeAlert(message: string, locale: string): Promise<void> {
  await backend.alert(message, locale);
}

function isOperationBusy(ref: MutableRefObject<FileOperation | null>): boolean {
  return ref.current !== null;
}

function operationNotice(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.opening");
  if (op === "save") return t("op.saving");
  if (op === "saveAs") return t("op.savingAs");
  if (op === "exportHtml") return t("op.exportingHtml");
  return t("op.exporting");
}

function operationNoticeDone(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.opened");
  if (op === "export") return t("op.pdfExported");
  if (op === "exportHtml") return t("op.htmlExported");
  return t("op.saved");
}

function operationNoticeError(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.openError");
  if (op === "export") return t("op.exportError");
  if (op === "exportHtml") return t("op.exportHtmlError");
  return t("op.saveError");
}

function operationErrorPrefix(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.openErrorPrefix");
  if (op === "export") return t("op.exportErrorPrefix");
  if (op === "exportHtml") return t("op.exportHtmlErrorPrefix");
  return t("op.saveErrorPrefix");
}

const INITIAL_PREFERENCES = loadPreferences();

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * @param existing - documents already open, so an untitled one gets a name none
 * of them is using. Required rather than optional: getting it wrong produces
 * two tabs called the same thing.
 */
function makeDoc(
  content: string,
  existing: Doc[],
  path: string | null = null,
  name?: string,
  kind?: DocKind,
): Doc {
  return {
    id: newId(),
    path,
    content,
    dirty: false,
    name: name ?? (path ? baseName(path) : nextUntitledName(existing)),
    kind: kind ?? (path ? kindFromPath(path) : "markdown"),
  };
}

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
  const [confirmRequest, setConfirmRequest] = useState<{
    message: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [renameRequest, setRenameRequest] = useState<{
    id: string;
    name: string;
    resolve: (name: string | null) => void;
  } | null>(null);
  const [conflictRequest, setConflictRequest] = useState<{
    id: string;
    name: string;
    diskContent: string;
  } | null>(null);
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
  });
  const [cursorLine, setCursorLine] = useState(0);

  // Extracted hooks
  useThemeEffect(theme);
  const { split, setSplit, dragging, splitRef, splitRatioRef, onDividerDown, onDividerMove, onDividerUp } =
    useSplitDivider(50);
  const { notice, showNotice, dismissNotice } = useNotice();
  const updates = useUpdateCheck(t, { showNotice, dismissNotice });

  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const docsRef = useRef<Doc[]>([]);
  const idsRef = useRef<string[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionTimerRef = useRef<number | undefined>(undefined);
  const activeIdRef = useRef("");
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  // Latest poll routine, so the once-scheduled interval always calls the
  // current render's version (fresh docs/lang) without re-registering.
  const checkExternalChangesRef = useRef<() => Promise<void>>(async () => {});
  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  activeIdRef.current = activeId;
  // Parsing runs over the whole document, so keep it off the keystroke path:
  // only the outline panel consumes this, and it is closed by default.
  const activeContent = active?.content ?? "";
  const headings = useMemo(
    () => (outlineOpen ? parseHeadings(activeContent) : EMPTY_HEADINGS),
    [outlineOpen, activeContent],
  );
  // Typst and LaTeX currently do not expose stable source locations in their
  // rendered output, so their preview↔editor sync controls must not pretend
  // to work. Markdown provides data-line metadata for both directions.
  const markdownSyncAvailable = (active?.kind ?? "markdown") === "markdown";
  // A Markdown deck that opts into Marp renders as slides, so the paged
  // Document/Web toggle and the A4 paper background do not apply to it.
  const isActiveMarp = useMemo(
    () => markdownSyncAvailable && isMarpDocument(activeContent),
    [markdownSyncAvailable, activeContent],
  );

  // Switching away from the deck (another tab, or the front-matter removed)
  // leaves nothing to present, so drop out of the overlay instead of letting
  // it silently reappear on the way back.
  useEffect(() => {
    if (presenting && !isActiveMarp) setPresenting(false);
  }, [presenting, isActiveMarp]);

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
    docsRef.current = next;
    setDocs(next);
    if (activateId) setActiveId(activateId);
  }, []);

  const openPaths = useCallback((documents: Doc[]): Promise<void> => {
    const next = openQueueRef.current.then(() => {
      mergeDocuments(documents);
    });
    openQueueRef.current = next.catch(() => undefined);
    return next;
  }, [mergeDocuments]);

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
    if (!ready || !isTauri()) return;
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

  const updateContent = useCallback((content: string) => {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === activeIdRef.current && d.content !== content
          ? { ...d, content, dirty: true }
          : d,
      ),
    );
  }, []);

  const newTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc("", docsRef.current);
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

  const newTypstTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc(TYPST_SAMPLE, docsRef.current, null, undefined, "typst");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

  const newLatexTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc(LATEX_SAMPLE, docsRef.current, null, undefined, "latex");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

  const newMarpTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    // A Marp deck is Markdown that opts in via front-matter, so the kind stays
    // "markdown"; the preview detects the opt-in and renders slides.
    const doc = makeDoc(MARP_SAMPLE, docsRef.current, null, undefined, "markdown");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

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

  /** Move `step` tabs from the active one, wrapping around like the tab bar. */
  const cycleTab = useCallback((step: number) => {
    const list = docsRef.current;
    if (list.length < 2) return;
    const current = list.findIndex((d) => d.id === activeIdRef.current);
    if (current === -1) return;
    const next = (current + step + list.length) % list.length;
    setActiveId(list[next].id);
  }, []);

  // In-window confirmation (replaces the native GTK/system dialog). Stable
  // identity so the once-registered close guard can reference it safely.
  const confirmDialog = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmRequest({ message, resolve });
    });
  }, []);

  // In-window rename dialog (replaces the native window.prompt).
  const renameDialog = useCallback(
    (id: string, name: string): Promise<string | null> => {
      return new Promise((resolve) => {
        setRenameRequest({ id, name, resolve });
      });
    },
    [],
  );

  async function openFiles() {
    if (!beginOperation("open")) return;
    try {
      const opened = (await backend.openFiles(lang)).map(normalizeDoc);
      if (opened.length) {
        await openPaths(opened);
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

  function writeFileOrdered(handle: string, content: string): Promise<void> {
    const next = saveQueueRef.current.then(() =>
      backend.saveDocument(handle, content, lang),
    );
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
        await showNativeAlert(
          closeTRef.current("session.saveError"),
          closeLangRef.current,
        );
        return;
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
    if (!active.handle) {
      await saveAs();
      return;
    }
    if (!beginOperation("save")) return;
    try {
      const savedContent = active.content;
      await writeFileOrdered(active.handle, savedContent);
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
   * itself, skipped while a native dialog owns the UI or a conflict modal is
   * up, and stopped at the first conflict so documents resolve one at a time.
   */
  async function checkExternalChanges() {
    if (
      watchInflightRef.current ||
      busyOperationRef.current !== null ||
      conflictBusyRef.current
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
  }

  function resolveConflictSaveAs() {
    const req = conflictRequest;
    conflictBusyRef.current = false;
    setConflictRequest(null);
    if (req) void saveAs(req.id);
  }

  async function exportPdf() {
    if (!active || !isTauri() || !beginOperation("export")) return;
    try {
      const base = active.name.replace(/\.(md|markdown|txt|typ|typst|tex|latex|ltx)$/i, "") || t("doc.defaultExport");
      if (active.kind === "typst") {
        // Typst: compile to PDF via WASM (reuses the same cached module as
        // the preview), then save via Tauri dialog.
        const { $typst } = await getTypst();
        const pdfBytes = await $typst.pdf({ mainContent: active.content });
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
        await backend.exportPdf(`${base}.pdf`, lang, true, widthIn, heightIn);
      } else {
        await backend.exportPdf(`${base}.pdf`, lang,
          // The paginated preview already draws A4 pages with their own
          // margins; asking the printer for margins too would inset every
          // page a second time and split it across two sheets.
          docView);
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
    try {
      await backend.printDocument(lang);
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
   * Open the find panel, bringing the editor back if it is hidden.
   *
   * Ctrl+K deliberately refuses to do that (see the shortcut below): it moves
   * focus, and moving focus into a pane nobody can see is worse than doing
   * nothing. Picking "find" from the menu is an explicit request, so it takes
   * the reader to the source instead of quietly failing.
   */
  function findInDocument() {
    if (!ready) return;
    if (layoutMode === "preview") {
      setLayoutMode(revealing("editor"));
      requestAnimationFrame(() => editorRef.current?.focusSearch());
      return;
    }
    editorRef.current?.focusSearch();
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
    focusSearch: () => {
      // Ctrl+K is the only shortcut that moves focus, so it must not steal
      // it from other inputs (LanguagePicker search, rename dialog) or open
      // the search panel behind a modal dialog.
      if (!ready) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return;
      }
      if (confirmRequest || renameRequest || shortcutsOpen) return;
      if (preferencesOpen || aboutOpen) return;
      // The editor is hidden in preview-only mode: focusing it would move the
      // caret somewhere the user cannot see.
      if (layoutMode === "preview") return;
      editorRef.current?.focusSearch();
    },
    setLayout: chooseLayout,
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
  /*
   * Whether "export to PDF" leads anywhere for the document in front of us.
   *
   * Not a single answer per platform, because the two routes are different.
   * Typst and LaTeX compile to PDF in the frontend's own WASM and hand the
   * bytes to Rust to write, which works anywhere the file dialog does —
   * Android included. Markdown goes through the webview's native printing,
   * which exists on Linux and Windows only, so on a phone the entry would be
   * a menu row whose entire job is to raise an error.
   *
   * `platform` is null until Rust answers, and in a browser where there is
   * nothing to ask; that counts as available so the menu does not flicker.
   *
   * LaTeX is a third case: while LATEX_ENABLED is false the preview says so,
   * but a .tex file can still be opened — the picker still accepts one, and a
   * restored session still brings one back — so the entry has to go too.
   * Otherwise the document reads "LaTeX is disabled" and the menu still
   * offers to compile it with the engine that was disabled.
   */
  const activeKind = active?.kind ?? "markdown";
  const pdfExportAvailable =
    (LATEX_ENABLED || activeKind !== "latex") &&
    (!isMobilePlatform(platform) || activeKind !== "markdown");

  /*
   * The updater is a desktop plugin and is not compiled into the mobile
   * build, so the menu entry is absent there rather than failing when
   * pressed. `platform` is null until Rust answers; treating that as
   * "not mobile" is what keeps a desktop from flickering the entry in and
   * out on startup, and matches what pdfExportAvailable above does.
   *
   * It is also absent when the build has no updater configured, which is
   * every build until the signing keys exist. Without it `check()` throws on
   * the missing endpoints, and 0.1.9 shipped an entry that could only ever
   * answer with a red "could not check". Offering a control that cannot work
   * is worse than not offering it.
   */
  const updateCheckAvailable =
    __UPDATER_ENABLED__ && isTauri() && !isMobilePlatform(platform);

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
        <div
          className="pane"
          style={{ flex: paneFlex(split) }}
        >
          <div className="pane-header">
            <span className="pane-title">{t("pane.editor")}</span>
            {/* Shown whenever the editor is, like its counterpart in the
                other pane: from an editor-only layout it brings the preview
                back and scrolls there. */}
            {markdownSyncAvailable && (
              <button
                type="button"
                className="sync-btn"
                onClick={handleForwardSync}
                aria-label={t("pane.scrollToPreview")}
                title={t("pane.scrollToPreview")}
              >
                <svg aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
                {t("pane.goToPreview")}
              </button>
            )}
            {/* Only where they are the only way. A touch keyboard has no Ctrl,
                so without these there is no undo at all; on a desktop Ctrl+Z
                is right there and two more buttons would just be clutter. */}
            {coarsePointer && (
              <>
                <button
                  type="button"
                  className="sync-btn history-btn"
                  onClick={() => editorRef.current?.undo()}
                  aria-label={t("editor.undo")}
                  title={t("editor.undo")}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="sync-btn history-btn"
                  onClick={() => editorRef.current?.redo()}
                  aria-label={t("editor.redo")}
                  title={t("editor.redo")}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 7v6h-6" />
                    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
                  </svg>
                </button>
              </>
            )}
            <button
              type="button"
              className={wrap ? "sync-btn on" : "sync-btn"}
              aria-pressed={wrap}
              aria-label={wrap ? t("pane.wrapOn") : t("pane.wrapOff")}
              onClick={() => setWrap((w) => !w)}
              title={t("pane.wrapTitle")}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12H3" />
                <path d="M21 6H3" />
                <path d="M21 18H3" />
              </svg>
            </button>
            <button
              type="button"
              className={outlineOpen ? "sync-btn on" : "sync-btn"}
              aria-expanded={outlineOpen}
              aria-controls="document-outline"
              aria-label={t("outline.toggle")}
              title={t("outline.toggle")}
              onClick={() => setOutlineOpen((v) => !v)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 6h13" />
                <path d="M8 12h13" />
                <path d="M8 18h13" />
                <path d="M3 6h.01" />
                <path d="M3 12h.01" />
                <path d="M3 18h.01" />
              </svg>
            </button>
          </div>
          <div id="document-outline" hidden={!outlineOpen}>
            {outlineOpen && (
              <Outline
                t={t}
                headings={headings}
                cursorLine={cursorLine}
                onGoToLine={(line) => editorRef.current?.scrollToLine(line)}
              />
            )}
          </div>
          <Suspense fallback={<div className="editor-loading" role="status">{t("editor.loading")}</div>}>
            <Editor
              ref={editorRef}
              activeId={activeId}
              ids={idsRef.current}
              content={active?.content ?? ""}
              onChange={updateContent}
              wrap={wrap}
              fontSize={editorPrefs.editorFontSize}
              fontFamily={editorPrefs.editorFontFamily}
              spellcheck={editorPrefs.spellcheck}
              zenMode={zenMode}
              zenPlaceholder={t("zen.placeholder")}
              kind={active?.kind ?? "markdown"}
              docHandle={active?.handle ?? null}
              locale={lang}
              onCursorLineChange={setCursorLine}
              onImageError={(error) =>
                showNotice(
                  error.kind === "tooLarge"
                    ? t("image.tooLarge", error.name, error.maxMiB)
                    : error.kind === "notStored"
                      ? t("image.notStored", error.name)
                      : t("image.insertFailed", error.name),
                  "error",
                )
              }
            />
          </Suspense>
        </div>
        <div
          className="split-divider"
          role="separator"
          aria-orientation={compactLayout ? "horizontal" : "vertical"}
          aria-label={t("pane.resize")}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(split)}
          tabIndex={0}
          onKeyDown={(e) => {
            const decrease = compactLayout ? "ArrowUp" : "ArrowLeft";
            const increase = compactLayout ? "ArrowDown" : "ArrowRight";
            if (e.key === decrease || e.key === increase) {
              e.preventDefault();
              const delta = e.key === decrease ? -5 : 5;
              setSplit((value) => {
                const next = Math.max(20, Math.min(80, value + delta));
                splitRatioRef.current = next;
                return next;
              });
            }
          }}
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onLostPointerCapture={onDividerUp}
        />
        <div className="pane" style={{ flex: paneFlex(100 - split) }}>
          <div className="pane-header">
            <span className="pane-title">{t("pane.preview")}</span>
            {markdownSyncAvailable && (
              <button
                type="button"
                className="sync-btn"
                onClick={handleReverseSyncButton}
                aria-label={t("pane.scrollToCode")}
                title={t("pane.scrollToCode")}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" />
                  <path d="m11 18-6-6 6-6" />
                </svg>
                {t("pane.goToCode")}
              </button>
            )}
            {(active?.kind ?? "markdown") !== "typst" && (active?.kind ?? "markdown") !== "latex" && !isActiveMarp && (
              <button
                type="button"
                className={docView ? "sync-btn on" : "sync-btn"}
                onClick={() => setDocView((v) => !v)}
                aria-label={t("pane.viewMode")}
                title={t("pane.viewMode")}
              >
                <span className="pane-view-label">{docView ? t("pane.document") : t("pane.web")}</span>
              </button>
            )}
          </div>
          <div
            className={
              "preview-scroll" +
              (docView && (active?.kind ?? "markdown") === "markdown" && !isActiveMarp ? " doc-bg" : "")
            }
          >
            <Preview
              ref={previewRef}
              value={active?.content ?? ""}
              docView={docView}
              kind={active?.kind ?? "markdown"}
              landscapeTables={editorPrefs.landscapeTables}
              docHandle={active?.handle ?? null}
              theme={theme}
              onReverseSync={handleReverseSync}
            />
          </div>
        </div>
      </div>
      <StatusBar
        t={t}
        content={active?.content ?? ""}
        docName={active?.name}
        dirty={active?.dirty}
      />
      {confirmRequest && (
        <ConfirmDialog
          title={t("confirm.title")}
          message={confirmRequest.message}
          confirmLabel={t("confirm.yes")}
          cancelLabel={t("confirm.no")}
          onConfirm={() => {
            confirmRequest.resolve(true);
            setConfirmRequest(null);
          }}
          onCancel={() => {
            confirmRequest.resolve(false);
            setConfirmRequest(null);
          }}
        />
      )}
      {updates.offer && (
        <ConfirmDialog
          title={t("update.title")}
          message={t("update.available", updates.offer.version, updates.offer.current)}
          confirmLabel={t("update.install")}
          cancelLabel={t("update.later")}
          onConfirm={() => {
            void updates.offer?.install();
          }}
          onCancel={updates.dismiss}
        />
      )}
      {conflictRequest && (
        <ConflictDialog
          title={t("conflict.externalTitle")}
          message={t("conflict.externalMessage", conflictRequest.name)}
          reloadLabel={t("conflict.reload")}
          keepLabel={t("conflict.keepMine")}
          saveAsLabel={t("conflict.saveAsAction")}
          onReload={resolveConflictReload}
          onKeep={resolveConflictKeep}
          onSaveAs={resolveConflictSaveAs}
        />
      )}
      {renameRequest && (
        <RenameDialog
          title={t("tab.renameTitle")}
          label={t("tab.renamePrompt")}
          initialValue={renameRequest.name}
          confirmLabel={t("tab.rename")}
          cancelLabel={t("tab.renameCancel")}
          onConfirm={(name) => {
            renameRequest.resolve(name);
            setRenameRequest(null);
          }}
          onCancel={() => {
            renameRequest.resolve(null);
            setRenameRequest(null);
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsOverlay t={t} onClose={() => setShortcutsOpen(false)} />}
      {aboutOpen && <AboutDialog t={t} onClose={() => setAboutOpen(false)} />}
      {preferencesOpen && (
        <Suspense fallback={null}>
          <PreferencesDialog
            t={t}
            value={editorPrefs}
            onChange={setEditorPrefs}
            onClose={() => setPreferencesOpen(false)}
          />
        </Suspense>
      )}
      {presenting && isActiveMarp && (
        <Suspense fallback={null}>
          <PresentOverlay content={activeContent} t={t} onExit={exitPresent} />
        </Suspense>
      )}
    </div>
  );
}
