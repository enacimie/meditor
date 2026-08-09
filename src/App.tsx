import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { EditorHandle } from "./Editor";

const Editor = lazy(() => import("./Editor"));
import Preview, { type PreviewHandle } from "./Preview";
import { SAMPLE } from "./sample";

import type { Doc } from "./types";
import "./App.css";

type Notice = {
  kind: "info" | "success" | "error";
  message: string;
};

type FileOperation = "open" | "save" | "saveAs" | "export";
type Theme = "system" | "light" | "dark";

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

function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
    const stored = value as Partial<Preferences>;
    const theme = stored.theme === "light" || stored.theme === "dark" || stored.theme === "system"
      ? stored.theme
      : DEFAULT_PREFERENCES.theme;
    return {
      docView: typeof stored.docView === "boolean" ? stored.docView : DEFAULT_PREFERENCES.docView,
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
    // El almacenamiento puede estar deshabilitado o no disponible en un WebView.
  }
}

async function showNativeAlert(message: string): Promise<void> {
  try {
    await invoke("alert", { message });
  } catch (error) {
    console.error("No se pudo mostrar el aviso nativo", error);
  }
}

function isOperationBusy(ref: MutableRefObject<FileOperation | null>): boolean {
  return ref.current !== null;
}

function operationNotice(operation: FileOperation): string {
  return operation === "open"
    ? "Abriendo archivos…"
    : operation === "save"
      ? "Guardando…"
      : operation === "saveAs"
        ? "Guardando como…"
        : "Exportando PDF…";
}

function operationNoticeDone(operation: FileOperation): string {
  return operation === "open"
    ? "Archivos abiertos"
    : operation === "export"
      ? "PDF exportado"
      : "Documento guardado";
}

function operationNoticeError(operation: FileOperation): string {
  return operation === "open"
    ? "No se pudieron abrir los archivos"
    : operation === "export"
      ? "No se pudo exportar el PDF"
      : "No se pudo guardar el documento";
}

function operationErrorPrefix(operation: FileOperation): string {
  return operation === "open"
    ? "No se pudieron abrir los archivos: "
    : operation === "export"
      ? "Error al exportar PDF: "
      : "No se pudo guardar: ";
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

function makeDoc(content: string, path: string | null = null, name?: string): Doc {
  untitledCounter += 1;
  return {
    id: newId(),
    path,
    content,
    dirty: false,
    name: name ?? (path ? baseName(path) : `Documento ${untitledCounter}`),
  };
}

function waitForCloseTasks(tasks: Promise<unknown>[], timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    void Promise.allSettled(tasks).then(finish);
  });
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState("");
  const [docView, setDocView] = useState(INITIAL_PREFERENCES.docView);
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [wrap, setWrap] = useState(INITIAL_PREFERENCES.wrap);
  const [theme, setTheme] = useState<Theme>(INITIAL_PREFERENCES.theme);
  const [compactLayout, setCompactLayout] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyOperation, setBusyOperation] = useState<FileOperation | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<Doc[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const idsRef = useRef<string[]>([]);
  const splitRatioRef = useRef(50);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionTimerRef = useRef<number | undefined>(undefined);
  const activeIdRef = useRef("");
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingOpenDocsRef = useRef<Doc[]>([]);
  const closingRef = useRef(false);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const busyOperationRef = useRef<FileOperation | null>(null);
  const operationRefs = useRef({
    save: () => {},
    saveAs: () => {},
    openFiles: () => {},
    exportPdf: () => {},
    closeTab: (_id: string) => {},
  });

  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  activeIdRef.current = activeId;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let base: Doc[] = [];
      let startActive = "";
      let cliDocs: Doc[] = [];
      if (isTauri()) {
        try {
          cliDocs = await invoke<Doc[]>("cli_files");
        } catch {
          cliDocs = [];
        }
        try {
          const restored = await invoke<{
            docs: Doc[];
            activeId: string;
            split: number;
          } | null>("load_session");
          if (restored) {
            base = restored.docs;
            startActive = restored.activeId;
            splitRatioRef.current = restored.split;
          }
        } catch (error) {
          console.warn("No se pudo restaurar la sesión", error);
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
        base.push({ ...incoming, id: newId() });
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
  }, []);

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
          console.warn("Se descartaron aperturas externas antiguas por exceso de cola");
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
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested((e) => {
      e.preventDefault();
      if (closingRef.current) return;
      closingRef.current = true;

      void (async () => {
        try {
          const hasDirtyDocuments = docsRef.current.some((d) => d.dirty);
          if (hasDirtyDocuments) {
            const ok = await invoke<boolean>("confirm", {
              message: "Hay documentos con cambios sin guardar. ¿Salir de todos modos?",
            });
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
          await waitForCloseTasks([
            saveQueueRef.current,
            finalSession,
            sessionSaveQueueRef.current,
          ]);
          try {
            await win.destroy();
          } catch (destroyError) {
            console.error("No se pudo destruir la ventana; se reintentará el cierre", destroyError);
            try {
              await unlisten.then((remove) => remove());
              await win.close();
            } catch (closeError) {
              console.error("No se pudo cerrar la ventana", closeError);
            }
          }
        } catch (error) {
          console.error("No se pudo cerrar la aplicación", error);
        } finally {
          closingRef.current = false;
        }
      })();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!ready || !isTauri()) return;
    if (sessionTimerRef.current !== undefined) {
      window.clearTimeout(sessionTimerRef.current);
    }
    sessionTimerRef.current = window.setTimeout(() => {
      sessionTimerRef.current = undefined;
      writeSessionOrdered(docs, activeId, splitRatioRef.current).catch((error) =>
        console.error("No se pudo guardar la sesión", error),
      );
    }, 500);
    return () => {
      if (sessionTimerRef.current !== undefined) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
    };
  }, [docs, activeId, ready]);

  useEffect(() => {
    document.title = active?.name ?? "meditor";
  }, [active?.name]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      if (theme === "system") {
        delete root.dataset.theme;
        root.style.colorScheme = "light dark";
      } else {
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
      }
      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      themeColor?.setAttribute("content", dark ? "#1e1e1e" : "#0969da");
    };
    updateTheme();
    if (theme !== "system") return;
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, [theme]);

  useEffect(() => {
    if (!ready) return;
    savePreferences({ docView, wrap, theme });
  }, [docView, wrap, theme, ready]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== undefined) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  function beginOperation(operation: FileOperation): boolean {
    if (isOperationBusy(busyOperationRef)) return false;
    busyOperationRef.current = operation;
    setBusyOperation(operation);
    showNotice(operationNotice(operation), "info", 0);
    return true;
  }

  function endOperation(operation: FileOperation): void {
    if (busyOperationRef.current !== operation) return;
    busyOperationRef.current = null;
    setBusyOperation(null);
    const pending = pendingOpenDocsRef.current.splice(0);
    if (pending.length) void openPaths(pending);
  }

  function showNotice(
    message: string,
    kind: Notice["kind"] = "info",
    duration = 3500,
  ) {
    if (noticeTimerRef.current !== undefined) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = undefined;
    }
    setNotice({ message, kind });
    if (duration > 0) {
      noticeTimerRef.current = window.setTimeout(() => {
        noticeTimerRef.current = undefined;
        setNotice(null);
      }, duration);
    }
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const firstItem = menuRef.current?.querySelector<HTMLElement>("[role=menuitem]");
    firstItem?.focus();

    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function handleMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ),
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      items[(current + delta + items.length) % items.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      menuToggleRef.current?.focus();
    }
  }

  function updateContent(content: string) {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === activeId && d.content !== content
          ? { ...d, content, dirty: true }
          : d,
      ),
    );
  }

  function newTab() {
    if (isOperationBusy(busyOperationRef)) return;
    const doc = makeDoc("");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }

  function mergeDocuments(incoming: Doc[]): void {
    if (!incoming.length) return;
    const next = [...docsRef.current];
    let activateId = "";
    for (const incomingDoc of incoming) {
      const ex = next.find((d) => d.path === incomingDoc.path);
      if (ex) {
        if (!activateId) activateId = ex.id;
        continue;
      }
      const doc = { ...incomingDoc, id: newId() };
      next.push(doc);
      if (!activateId) activateId = doc.id;
    }
    docsRef.current = next;
    setDocs(next);
    if (activateId) setActiveId(activateId);
  }

  function openPaths(documents: Doc[]): Promise<void> {
    const next = openQueueRef.current.then(() => {
      mergeDocuments(documents);
    });
    openQueueRef.current = next.catch(() => undefined);
    return next;
  }

  async function openFiles() {
    if (!isTauri() || !beginOperation("open")) return;
    try {
      const opened = await invoke<Doc[]>("open_files");
      if (opened.length) {
        await openPaths(opened);
        showNotice(
          `${opened.length} archivo${opened.length === 1 ? "" : "s"} abierto${opened.length === 1 ? "" : "s"}`,
          "success",
        );
      } else {
        showNotice("Apertura cancelada", "info");
      }
    } catch (error) {
      showNotice(operationNoticeError("open"), "error", 0);
      await showNativeAlert(operationErrorPrefix("open") + String(error));
    } finally {
      endOperation("open");
    }
  }

  function writeFileOrdered(handle: string, content: string): Promise<void> {
    const next = saveQueueRef.current.then(() =>
      invoke<void>("save_document", { handle, content }),
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
          docs: documents.map(({ id, name, path, content, dirty, handle }) => ({
            id,
            name,
            path,
            content,
            dirty,
            handle,
          })),
          activeId: currentActiveId,
          split: ratio,
        },
      }),
    );
    sessionSaveQueueRef.current = next.catch(() => undefined);
    return next;
  }

  async function saveAs() {
    if (!active || !isTauri() || !beginOperation("saveAs")) return;
    const documentId = active.id;
    const savedContent = active.content;
    const defaultName = active.name.endsWith(".md")
      ? active.name
      : `${active.name}.md`;
    try {
      const saved = await invoke<Doc | null>("save_as", {
        content: savedContent,
        defaultName,
      });
      if (!saved) {
        showNotice("Guardado cancelado", "info");
        return;
      }
      setDocs((prev) =>
        prev.map((d) =>
          d.id === documentId
            ? {
                ...d,
                path: saved.path,
                name: saved.name,
                handle: saved.handle,
                dirty: d.content === savedContent ? false : d.dirty,
              }
            : d,
        ),
      );
      showNotice(operationNoticeDone("saveAs"), "success");
    } catch (e) {
      showNotice(operationNoticeError("saveAs"), "error", 0);
      await showNativeAlert(operationErrorPrefix("saveAs") + String(e));
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
      showNotice(operationNoticeDone("save"), "success");
    } catch (e) {
      showNotice(operationNoticeError("save"), "error", 0);
      await showNativeAlert(operationErrorPrefix("save") + String(e));
    } finally {
      endOperation("save");
    }
  }

  async function exportPdf() {
    if (!active || !isTauri() || !beginOperation("export")) return;
    try {
      const base = active.name.replace(/\.(md|markdown|txt)$/i, "") || "documento";
      await invoke("export_pdf", { defaultName: `${base}.pdf` });
      showNotice(operationNoticeDone("export"), "success");
    } catch (e) {
      showNotice(operationNoticeError("export"), "error", 0);
      await showNativeAlert(operationErrorPrefix("export") + String(e));
    } finally {
      endOperation("export");
    }
  }

  async function closeTab(id: string) {
    if (isOperationBusy(busyOperationRef)) return;
    const initial = docsRef.current.find((d) => d.id === id);
    if (!initial) return;
    if (initial.dirty) {
      const ok = await invoke<boolean>("confirm", {
        message: `"${initial.name}" tiene cambios sin guardar. ¿Cerrar de todos modos?`,
      });
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

  function renameTab(id: string) {
    const current = docs.find((d) => d.id === id);
    if (!current) return;
    const name = window.prompt("Nombre del documento", current.name);
    if (name && name.trim()) {
      const clean = name.trim();
      setDocs((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name: clean } : d)),
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

  function onDividerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDividerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vertical = window.matchMedia("(max-width: 760px)").matches;
    const size = vertical ? rect.height : rect.width;
    if (size === 0) return;
    const offset = vertical ? e.clientY - rect.top : e.clientX - rect.left;
    const pct = Math.max(20, Math.min(80, (offset / size) * 100));
    splitRatioRef.current = pct;
    setSplit(pct);
  }

  function onDividerUp(e: ReactPointerEvent<HTMLDivElement>) {
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    splitRatioRef.current = Math.max(20, Math.min(80, splitRatioRef.current));
  }

  operationRefs.current = {
    save,
    saveAs,
    openFiles,
    exportPdf,
    closeTab,
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuToggleRef.current?.focus();
        return;
      }
      if (!ready || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) operationRefs.current.saveAs();
        else operationRefs.current.save();
      } else if (k === "o") {
        e.preventDefault();
        operationRefs.current.openFiles();
      } else if (k === "n") {
        e.preventDefault();
        newTab();
      } else if (k === "e") {
        e.preventDefault();
        operationRefs.current.exportPdf();
      } else if (k === "w") {
        e.preventDefault();
        operationRefs.current.closeTab(activeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, activeId]);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="splash-logo">meditor</div>
          <div className="splash-bar">
            <div className="splash-bar-fill" />
          </div>
          <div className="splash-hint">Cargando...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">meditor</span>
        {notice && (
          <div
            className={`app-notice ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
            aria-live={notice.kind === "error" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <span className="app-notice-dot" aria-hidden="true" />
            {notice.message}
          </div>
        )}
        <div className="actions">
          <button
            type="button"
            aria-label="Nueva pestaña (Ctrl+N)"
            onClick={newTab}
            title="Nuevo (Ctrl+N)"
            disabled={busyOperation !== null}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            <span className="btn-label">Nuevo</span>
          </button>
          <button type="button" aria-label="Abrir archivos (Ctrl+O)" onClick={openFiles} title="Abrir (Ctrl+O)" disabled={busyOperation !== null}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            <span className="btn-label">Abrir</span>
          </button>
          <button type="button" aria-label="Guardar (Ctrl+S)" onClick={save} title="Guardar (Ctrl+S)" disabled={busyOperation !== null}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
            <span className="btn-label">Guardar</span>
          </button>
          <div className="menu-dropdown" ref={menuRef}>
            <button
              type="button"
              className="menu-toggle"
              disabled={busyOperation !== null}
              title="Más opciones"
              aria-label="Más opciones"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-controls="app-menu"
              ref={menuToggleRef}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
            {menuOpen && (
              <div id="app-menu" className="menu-panel" role="menu" aria-label="Más opciones" onKeyDown={handleMenuKeyDown}>
                <button type="button" role="menuitem" disabled={busyOperation !== null} onClick={() => { saveAs(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                  Guardar como<span className="shortcut">Ctrl+Shift+S</span>
                </button>
                <button type="button" role="menuitem" disabled={busyOperation !== null} onClick={() => { exportPdf(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>
                  Exportar PDF<span className="shortcut">Ctrl+E</span>
                </button>
                <div className="menu-sep" />
                <div className="menu-section-label" aria-hidden="true">Tema</div>
                {([
                  ["system", "Sistema", "Seguir el tema del sistema"],
                  ["light", "Claro", "Interfaz clara"],
                  ["dark", "Oscuro", "Interfaz oscura"],
                ] as const).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === value}
                    disabled={busyOperation !== null}
                    title={description}
                    onClick={() => {
                      setTheme(value);
                      setMenuOpen(false);
                      menuToggleRef.current?.focus();
                    }}
                  >
                    <span className="theme-swatch" data-theme-swatch={value} aria-hidden="true" />
                    {label}
                    {theme === value && <span className="theme-check" aria-label="seleccionado">✓</span>}
                  </button>
                ))}
                <div className="menu-sep" />
                <button type="button" role="menuitem" disabled={busyOperation !== null} onClick={() => { newTab(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  Nueva pestaña<span className="shortcut">Ctrl+N</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="tabbar" role="tablist" aria-label="Documentos abiertos">
        {docs.map((d) => (
          <div
            key={d.id}
            className={"tab" + (d.id === activeId ? " active" : "")}
            role="presentation"
          >
            <button
              type="button"
              className="tab-main"
              id={`tab-${d.id}`}
              disabled={busyOperation !== null}
              role="tab"
              tabIndex={d.id === activeId ? 0 : -1}
              aria-selected={d.id === activeId}
              aria-controls="workspace-panels"
              onKeyDown={(e) => {
                const index = docs.findIndex((item) => item.id === d.id);
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = docs[(index + 1) % docs.length];
                  setActiveId(next.id);
                  (e.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[
                    (index + 1) % docs.length
                  ])?.focus();
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const previous = docs[(index - 1 + docs.length) % docs.length];
                  setActiveId(previous.id);
                  (e.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[
                    (index - 1 + docs.length) % docs.length
                  ])?.focus();
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveId(d.id);
                }
              }}
              onClick={() => setActiveId(d.id)}
              onDoubleClick={() => renameTab(d.id)}
              aria-label={`${d.name}${d.dirty ? ", cambios sin guardar" : ""}`}
              title={d.path ?? d.name}
            >
              {d.dirty && <span className="tab-dirty" aria-label="Cambios sin guardar">•</span>}
              <span className="tab-name">{d.name}</span>
            </button>
            {docs.length > 1 && (
              <button
                type="button"
                className="tab-close"
                aria-label={`Cerrar ${d.name}`}
                onClick={() => closeTab(d.id)}
                disabled={busyOperation !== null}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="tab-add"
          aria-label="Nueva pestaña"
          onClick={newTab}
          disabled={busyOperation !== null}
        >
          +
        </button>
      </div>
      <div
        id="workspace-panels"
        className={"split" + (dragging ? " dragging" : "")}
        ref={splitRef}
        role="tabpanel"
        aria-labelledby={active ? `tab-${active.id}` : undefined}
        aria-label={active?.name ?? "Documento activo"}
        tabIndex={-1}
      >
        <div
          className="pane"
          style={{ flex: `0 0 ${split}%` }}
        >
          <div className="pane-header">
            <span className="pane-title">Editor</span>
            <button
              type="button"
              className="sync-btn"
              onClick={handleForwardSync}
              aria-label="Ir a la posición del cursor en el preview"
              title="Ir a la posición del cursor en el preview"
            >
              <svg
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
              Ir al preview
            </button>
            <button
              type="button"
              className={wrap ? "sync-btn on" : "sync-btn"}
              aria-pressed={wrap}
              aria-label={wrap ? "Desactivar ajuste de línea" : "Activar ajuste de línea"}
              onClick={() => setWrap((w) => !w)}
              title="Ajuste de línea"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12H3" />
                <path d="M21 6H3" />
                <path d="M21 18H3" />
              </svg>
            </button>
          </div>
          <Suspense fallback={<div className="editor-loading" role="status">Cargando editor…</div>}>
            <Editor
              ref={editorRef}
              activeId={activeId}
              ids={idsRef.current}
              content={active?.content ?? ""}
              onChange={updateContent}
              wrap={wrap}
            />
          </Suspense>
        </div>
        <div
          className="split-divider"
          role="separator"
          aria-orientation={compactLayout ? "horizontal" : "vertical"}
          aria-label="Redimensionar paneles"
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
          onPointerCancel={onDividerUp}
          title="Arrastra para redimensionar"
        />
        <div
          className="pane"
          style={{ flex: compactLayout ? `0 0 ${100 - split}%` : "1 1 0" }}
        >
          <div className="pane-header">
            <span className="pane-title">Preview</span>
            <div className="view-toggle" role="group" aria-label="Vista previa">
              <button
                type="button"
                className={docView ? "" : "on"}
                aria-pressed={!docView}
                onClick={() => setDocView(false)}
              >
                Web
              </button>
              <button
                type="button"
                className={docView ? "on" : ""}
                aria-pressed={docView}
                onClick={() => setDocView(true)}
              >
                Documento
              </button>
            </div>
            <button
              type="button"
              className="sync-btn"
              onClick={handleReverseSyncButton}
              aria-label="Ir al código en la posición marcada"
              title="Ir al código en la posición marcada (haz clic en el preview para marcar)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <path d="m11 18-6-6 6-6" />
              </svg>
              Ir al código
            </button>
          </div>
          <div
            className={"preview-scroll" + (docView ? " doc-bg" : "")}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("[data-line]")) {
                previewRef.current?.clearMark();
              }
            }}
          >
            <Preview
              ref={previewRef}
              value={active?.content ?? ""}
              docView={docView}
              onReverseSync={handleReverseSync}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
