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
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { EditorHandle } from "./Editor";

const Editor = lazy(() => import("./Editor"));
import Preview, { type PreviewHandle } from "./Preview";
import { SAMPLE, TYPST_SAMPLE, LATEX_SAMPLE } from "./sample";
import Topbar from "./components/Topbar";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import ConfirmDialog from "./components/ConfirmDialog";
import RenameDialog from "./components/RenameDialog";
import ShortcutsOverlay from "./components/ShortcutsOverlay";
import AboutDialog from "./components/AboutDialog";
import Outline from "./components/Outline";
import { parseHeadings, type Heading } from "./components/outlineUtils";
import { useTranslation } from "./i18n/I18nProvider";
import { isRtl } from "./i18n/translations";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useSplitDivider } from "./hooks/useSplitDivider";
import { useNotice } from "./hooks/useNotice";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

import type { Doc, DocKind } from "./types";
import type { Theme } from "./components/types";
import { kindFromPath, normalizeDoc } from "./documentUtils";
import { getTypst } from "./typstEngine";
import { compileLatexToPdf } from "./latexEngine";
import "./App.css";

type FileOperation = "open" | "save" | "saveAs" | "export" | "exportHtml";

// Editor/preview preferences. The interface language is NOT part of this
// object: I18nProvider owns it (meditor.language.v1, with all 20 languages
// validated) so there is a single source of truth for the locale.
type Preferences = {
  docView: boolean;
  wrap: boolean;
  theme: Theme;
};

const PREFERENCES_KEY = "meditor.preferences.v1";
const DEFAULT_PREFERENCES: Preferences = {
  docView: true,
  wrap: true,
  theme: "system",
};
const MAX_PENDING_OPEN_DOCS = 256;
/** Stable empty list, so a closed outline does not re-render its consumers. */
const EMPTY_HEADINGS: Heading[] = [];

function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
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
    return {
      docView:
        typeof stored.docView === "boolean" ? stored.docView : DEFAULT_PREFERENCES.docView,
      wrap: typeof stored.wrap === "boolean" ? stored.wrap : DEFAULT_PREFERENCES.wrap,
      theme,
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
  try {
    await invoke("alert", { message, locale });
  } catch (error) {
    console.error("Could not show native alert", error);
  }
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

let untitledCounter = 0;

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makeDoc(
  content: string,
  path: string | null = null,
  name?: string,
  kind?: DocKind,
): Doc {
  untitledCounter += 1;
  return {
    id: newId(),
    path,
    content,
    dirty: false,
    name: name ?? (path ? baseName(path) : `Doc ${untitledCounter}`),
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [cursorLine, setCursorLine] = useState(0);

  // Extracted hooks
  useThemeEffect(theme);
  const { split, setSplit, dragging, splitRef, splitRatioRef, onDividerDown, onDividerMove, onDividerUp } =
    useSplitDivider(50);
  const { notice, showNotice } = useNotice();

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
      if (isTauri()) {
        try {
          cliDocs = (await invoke<Doc[]>("cli_files", { locale: lang })).map(normalizeDoc);
        } catch {
          cliDocs = [];
        }
        try {
          const restored = await invoke<{
            docs: Doc[];
            activeId: string;
            split: number;
          } | null>("load_session", { locale: lang });
          if (restored) {
            base = restored.docs.map(normalizeDoc);
            startActive = restored.activeId;
            splitRatioRef.current = restored.split;
          }
        } catch (error) {
          console.warn("Could not restore session", error);
          base = [];
        }
      }
      if (!base.length) {
        const d = makeDoc(SAMPLE);
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
          if (closingRef.current) return;
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
            await invoke("exit_app");
          } catch (error) {
            console.error("Could not close application", error);
            // Last resort: try a plain destroy. It is unreliable on
            // WebKitGTK, but works on other platforms and sometimes here.
            try {
              await win.destroy();
            } catch {
              // The window stays open; the user can retry the close.
            }
          } finally {
            closingRef.current = false;
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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



  useEffect(() => {
    if (!ready) return;
    savePreferences({ docView, wrap, theme });
  }, [docView, wrap, theme, ready]);

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
    const doc = makeDoc("");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

  const newTypstTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc(TYPST_SAMPLE, null, undefined, "typst");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

  const newLatexTab = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc(LATEX_SAMPLE, null, undefined, "latex");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }, []);

  const toggleZen = useCallback(() => {
    setZenMode((z) => !z);
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
    if (!isTauri() || !beginOperation("open")) return;
    try {
      const opened = (await invoke<Doc[]>("open_files", { locale: lang })).map(normalizeDoc);
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
      invoke<void>("save_document", { handle, content, locale: lang }),
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
      invoke<void>("save_session", {
        input: {
          docs: documents.map(({ id, name, path, content, dirty, handle, kind }) => ({
            id,
            name,
            path,
            content,
            dirty,
            handle,
            kind,
          })),
          activeId: currentActiveId,
          split: ratio,
        },
        locale: lang,
      }),
    );
    sessionSaveQueueRef.current = next.catch(() => undefined);
    return next;
  }

  async function saveAs() {
    if (!active || !isTauri() || !beginOperation("saveAs")) return;
    const documentId = active.id;
    const savedContent = active.content;
    const ext = active.kind === "typst" ? ".typ" : active.kind === "latex" ? ".tex" : ".md";
    const base = active.name.replace(/\.(md|markdown|txt|typ|typst|tex|latex|ltx)$/i, "");
    const defaultName = `${base}${ext}`;
    try {
      const savedPayload = await invoke<Doc | null>("save_as", {
        content: savedContent,
        defaultName,
        locale: lang,
      });
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
    if (!active || !isTauri()) return;
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
        await invoke("write_pdf_bytes", {
          pdfBytes: Array.from(pdfBytes),
          defaultName,
          locale: lang,
        });
      } else if (active.kind === "latex") {
        // LaTeX: compile to PDF via SwiftLaTeX WASM, then save via Tauri dialog.
        const pdfBytes = await compileLatexToPdf(active.content);
        if (!pdfBytes) throw new Error("LaTeX compilation produced no output");
        const defaultName = `${base}.pdf`;
        await invoke("write_pdf_bytes", {
          pdfBytes: Array.from(pdfBytes),
          defaultName,
          locale: lang,
        });
      } else {
        await invoke("export_pdf", { defaultName: `${base}.pdf`, locale: lang });
      }
      showNotice(operationNoticeDone(t, "export"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "export"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "export") + String(e), lang);
    } finally {
      endOperation("export");
    }
  }

  async function exportHtml() {
    // Markdown only: Typst and LaTeX render through their own engines, which
    // produce PDF rather than the HTML the preview builds.
    if (!active || active.kind !== "markdown" || !isTauri()) return;
    if (!beginOperation("exportHtml")) return;
    try {
      const base =
        active.name.replace(/\.(md|markdown|txt)$/i, "") || t("doc.defaultExport");
      const { exportMarkdownToHtml } = await import("./exportHtml");
      const html = await exportMarkdownToHtml(active.content, {
        fileName: base,
        lang,
        rtl: isRtl(lang),
        t,
      });
      const saved = await invoke<boolean>("write_html_file", {
        html,
        defaultName: `${base}.html`,
        locale: lang,
      });
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
    const next = current.filter((d) => d.id !== id);
    if (next.length === 0) {
      const fresh = makeDoc("");
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
    const fresh = makeDoc("");
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
    if (kept.length === 0) {
      const fresh = makeDoc("");
      docsRef.current = [fresh];
      setDocs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    docsRef.current = kept;
    setDocs(kept);
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

  function handleReverseSync(line: number) {
    editorRef.current?.scrollToLine(line);
  }

  function handleForwardSync() {
    const line = editorRef.current?.getCursorLine() ?? 0;
    previewRef.current?.scrollToLine(line);
  }

  function handleReverseSyncButton() {
    const line = previewRef.current?.getTargetLine() ?? 0;
    editorRef.current?.scrollToLine(line);
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
    closeTab: () => closeTab(activeId),
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
      editorRef.current?.focusSearch();
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

  return (
    <div className={`app${zenMode ? " zen" : ""}`}>
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
        onOpen={openFiles}
        onSave={save}
        onSaveAs={saveAs}
        onExportPdf={exportPdf}
        onExportHtml={active?.kind === "markdown" ? exportHtml : undefined}
        onCloseAll={closeAllTabs}
        onCloseOthers={closeOtherTabs}
        onAbout={() => setAboutOpen(true)}
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
          style={{ flex: `0 0 ${split}%` }}
        >
          <div className="pane-header">
            <span className="pane-title">{t("pane.editor")}</span>
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
              zenMode={zenMode}
              zenPlaceholder={t("zen.placeholder")}
              kind={active?.kind ?? "markdown"}
              onCursorLineChange={setCursorLine}
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
        <div className="pane" style={{ flex: `0 0 ${100 - split}%` }}>
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
            {(active?.kind ?? "markdown") !== "typst" && (active?.kind ?? "markdown") !== "latex" && (
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
              (docView && (active?.kind ?? "markdown") === "markdown" ? " doc-bg" : "")
            }
          >
            <Preview
              ref={previewRef}
              value={active?.content ?? ""}
              docView={docView}
              kind={active?.kind ?? "markdown"}
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
    </div>
  );
}
