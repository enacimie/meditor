import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import Editor, { type EditorHandle } from "./Editor";
import Preview, { type PreviewHandle } from "./Preview";
import { SAMPLE } from "./sample";
import "./App.css";

type Doc = {
  id: string;
  name: string;
  path: string | null;
  content: string;
  dirty: boolean;
};

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

export default function App() {
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState("");
  const [docView, setDocView] = useState(true);
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionFile = useRef<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<Doc[]>([]);
  const menuRef = useRef<HTMLButtonElement>(null);

  const active = docs.find((d) => d.id === activeId) ?? docs[0];

  useEffect(() => {
    (async () => {
      let base: Doc[] = [];
      let startActive = "";
      let cliFiles: string[] = [];
      if (isTauri()) {
        try {
          cliFiles = await invoke<string[]>("cli_files");
        } catch {
          cliFiles = [];
        }
        try {
          sessionFile.current = await invoke<string>("session_path");
          const raw = await invoke<string>("read_file", {
            path: sessionFile.current,
          });
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.docs) && parsed.docs.length) {
            base = parsed.docs;
            startActive = parsed.activeId;
          }
        } catch {
          base = [];
        }
      }
      if (!base.length) {
        const d = makeDoc(SAMPLE);
        base = [d];
        startActive = d.id;
      }
      let cliActive = "";
      for (const p of cliFiles) {
        const ex = base.find((d) => d.path === p);
        if (ex) {
          if (!cliActive) cliActive = ex.id;
          continue;
        }
        try {
          const content = await invoke<string>("read_file", { path: p });
          const doc = makeDoc(content, p);
          base.push(doc);
          if (!cliActive) cliActive = doc.id;
        } catch (e) {
          console.error("No se pudo abrir", p, e);
        }
      }
      if (cliActive) startActive = cliActive;
      setDocs(base);
      if (!startActive || !base.some((d) => d.id === startActive)) {
        startActive = base[0]?.id ?? "";
      }
      setActiveId(startActive);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string[]>("open-files", (e) => {
      void openPaths(e.payload);
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
      if (!docs.some((d) => d.dirty)) return;
      e.preventDefault();
      void invoke<boolean>("confirm", {
        message: "Hay documentos con cambios sin guardar. ¿Salir de todos modos?",
      }).then((ok) => {
        if (ok) win.close();
      });
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [docs]);

  useEffect(() => {
    if (!ready || !isTauri() || !sessionFile.current) return;
    const file = sessionFile.current;
    const t = setTimeout(() => {
      invoke("write_file", {
        path: file,
        content: JSON.stringify({ docs, activeId }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [docs, activeId, ready]);

  useEffect(() => {
    document.title = active?.name ?? "meditor";
  }, [active?.name]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

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
    const doc = makeDoc("");
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
  }

  async function openPaths(paths: string[]) {
    const loaded: { path: string; content: string }[] = [];
    for (const p of paths) {
      try {
        const content = await invoke<string>("read_file", { path: p });
        loaded.push({ path: p, content });
      } catch (e) {
        console.error("No se pudo abrir", p, e);
      }
    }
    if (!loaded.length) return;
    const activateId = await new Promise<string>((resolve) => {
      setDocs((prev) => {
        const next = [...prev];
        let firstId = "";
        for (const { path, content } of loaded) {
          const ex = next.find((d) => d.path === path);
          if (ex) {
            if (!firstId) firstId = ex.id;
            continue;
          }
          const doc = makeDoc(content, path);
          next.push(doc);
          if (!firstId) firstId = doc.id;
        }
        resolve(firstId);
        return next;
      });
    });
    if (activateId) setActiveId(activateId);
  }

  async function openFiles() {
    if (!isTauri()) return;
    const picked = await openDialog({
      multiple: true,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await openPaths(paths);
  }

  async function saveAs() {
    if (!active || !isTauri()) return;
    const defaultPath = active.name.endsWith(".md")
      ? active.name
      : `${active.name}.md`;
    const path = await saveDialog({ defaultPath });
    if (!path) return;
    const savedContent = active.content;
    try {
      await invoke("write_file", { path, content: savedContent });
    } catch (e) {
      window.alert("No se pudo guardar: " + String(e));
      return;
    }
    const id = active.id;
    setDocs((prev) =>
      prev.map((d) =>
        d.id === id && d.content === savedContent
          ? { ...d, path, name: baseName(path), dirty: false }
          : d,
      ),
    );
  }

  async function save() {
    if (!active || !isTauri()) return;
    if (!active.path) {
      await saveAs();
      return;
    }
    const savedContent = active.content;
    try {
      await invoke("write_file", { path: active.path, content: savedContent });
    } catch (e) {
      window.alert("No se pudo guardar: " + String(e));
      return;
    }
    const id = active.id;
    setDocs((prev) =>
      prev.map((d) =>
        d.id === id && d.content === savedContent ? { ...d, dirty: false } : d,
      ),
    );
  }

  async function exportPdf() {
    if (!active || !isTauri()) return;
    const base = active.name.replace(/\.(md|markdown|txt)$/i, "") || "documento";
    const path = await saveDialog({
      defaultPath: `${base}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    try {
      await invoke("export_pdf", { path });
    } catch (e) {
      window.alert("Error al exportar PDF: " + String(e));
    }
  }

  async function closeTab(id: string) {
    const doc = docs.find((d) => d.id === id);
    if (doc?.dirty) {
      const ok = await invoke<boolean>("confirm", {
        message: `"${doc.name}" tiene cambios sin guardar. ¿Cerrar de todos modos?`,
      });
      if (!ok) return;
    }
    const idx = docs.findIndex((d) => d.id === id);
    const next = docs.filter((d) => d.id !== id);
    if (next.length === 0) {
      const fresh = makeDoc("");
      setDocs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setDocs(next);
    if (id === activeId) setActiveId(next[Math.max(0, idx - 1)].id);
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
    if (!rect || rect.width === 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplit(Math.max(20, Math.min(80, pct)));
  }

  function onDividerUp(e: ReactPointerEvent<HTMLDivElement>) {
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!ready || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) saveAs();
        else save();
      } else if (k === "o") {
        e.preventDefault();
        openFiles();
      } else if (k === "n") {
        e.preventDefault();
        newTab();
      } else if (k === "e") {
        e.preventDefault();
        exportPdf();
      } else if (k === "w") {
        e.preventDefault();
        closeTab(activeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
        <div className="actions">
          <button onClick={newTab} title="Nuevo (Ctrl+N)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            <span className="btn-label">Nuevo</span>
          </button>
          <button onClick={openFiles} title="Abrir (Ctrl+O)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            <span className="btn-label">Abrir</span>
          </button>
          <button onClick={save} title="Guardar (Ctrl+S)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
            <span className="btn-label">Guardar</span>
          </button>
          <div className="menu-dropdown">
            <button className="menu-toggle" title="Más opciones" ref={menuRef} onClick={() => setMenuOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
            {menuOpen && (
              <div className="menu-panel" onMouseLeave={() => setMenuOpen(false)}>
                <button onClick={() => { saveAs(); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                  Guardar como<span className="shortcut">Ctrl+Shift+S</span>
                </button>
                <button onClick={() => { exportPdf(); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>
                  Exportar PDF<span className="shortcut">Ctrl+E</span>
                </button>
                <div className="menu-sep" />
                <button onClick={() => { newTab(); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  Nueva pestaña<span className="shortcut">Ctrl+N</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="tabbar">
        {docs.map((d) => (
          <div
            key={d.id}
            className={"tab" + (d.id === activeId ? " active" : "")}
            onClick={() => setActiveId(d.id)}
            onDoubleClick={() => renameTab(d.id)}
            title={d.path ?? d.name}
          >
            {d.dirty && <span className="tab-dirty">•</span>}
            <span className="tab-name">{d.name}</span>
            <button
              className="tab-close"
              aria-label="Cerrar pestaña"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(d.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="tab-add" aria-label="Nueva pestaña" onClick={newTab}>
          +
        </button>
      </div>
      <div className={"split" + (dragging ? " dragging" : "")} ref={splitRef}>
        <div className="pane" style={{ flex: `0 0 ${split}%` }}>
          <div className="pane-header">
            <span className="pane-title">Editor</span>
            <button
              className="sync-btn"
              onClick={handleForwardSync}
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
          </div>
          <Editor
            ref={editorRef}
            activeId={activeId}
            ids={docs.map((d) => d.id)}
            content={active?.content ?? ""}
            onChange={updateContent}
          />
        </div>
        <div
          className="split-divider"
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onPointerCancel={onDividerUp}
          title="Arrastra para redimensionar"
        />
        <div className="pane" style={{ flex: "1 1 0" }}>
          <div className="pane-header">
            <span className="pane-title">Preview</span>
            <div className="view-toggle" role="group" aria-label="Vista previa">
              <button
                className={docView ? "" : "on"}
                onClick={() => setDocView(false)}
              >
                Web
              </button>
              <button
                className={docView ? "on" : ""}
                onClick={() => setDocView(true)}
              >
                Documento
              </button>
            </div>
            <button
              className="sync-btn"
              onClick={handleReverseSyncButton}
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
