import { translations, type Language } from "../i18n/translations";
import type { Doc, DocKind } from "../types";
import type { Backend, BackendDocument } from "./types";

/**
 * Browser implementation of the backend contract.
 *
 * File access uses the File System Access API where it exists (Chromium
 * family): picked files keep a live handle, so saving writes in place and the
 * external-change watcher works exactly as on the desktop. Where the API is
 * missing (Firefox, Safari) opening falls back to a plain file input and
 * saving to a download — one-shot access, so those documents carry no handle
 * and every save routes through Save As, mirroring how Android treats a
 * content URI after a restart.
 *
 * The session lives in localStorage. Handles are deliberately NOT persisted:
 * browsers do not grant permission across reloads without a user gesture, and
 * pretending otherwise would produce saves that fail days later.
 */

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_BYTES = 5 * 1024 * 1024; // localStorage practical ceiling
const SESSION_KEY = "meditor.web.session.v3";
const PDF_MAGIC = "%PDF-";

type WebFileLike = {
  name: string;
  text(): Promise<string>;
  lastModified: number;
  size: number;
};

interface WritableLike {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FsFileHandleLike {
  kind: "file";
  name: string;
  getFile(): Promise<WebFileLike>;
  createWritable?(): Promise<WritableLike>;
}

type PickerOptions = {
  multiple?: boolean;
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
};

/** Minimal structural typing for APIs the DOM lib does not ship yet. */
type PickerWindow = Window & {
  showOpenFilePicker?(options?: PickerOptions): Promise<FsFileHandleLike[]>;
  showSaveFilePicker?(options?: PickerOptions): Promise<FsFileHandleLike>;
};

function fsaAvailable(): boolean {
  return typeof (window as PickerWindow).showOpenFilePicker === "function";
}

/** Live handles for documents opened or saved in this run. */
const handles = new Map<string, FsFileHandleLike>();
let nextHandleId = 1;

function registerHandle(handle: FsFileHandleLike): string {
  const id = `web-${nextHandleId}`;
  nextHandleId += 1;
  handles.set(id, handle);
  return id;
}

function kindFromName(name: string): DocKind {
  if (/\.(typ|typst)$/i.test(name)) return "typst";
  if (/\.(tex|latex|ltx)$/i.test(name)) return "latex";
  return "markdown";
}

/** Localized message using the same tables the UI renders with. */
function message(locale: string, key: string, args: unknown[] = []): string {
  const dict = translations[locale as Language] ?? translations.en;
  const value = (dict as Record<string, unknown>)[key];
  if (typeof value === "function") {
    return (value as (...a: unknown[]) => string)(...args);
  }
  if (typeof value === "string") return value;
  const fallback = (translations.en as Record<string, unknown>)[key];
  if (typeof fallback === "function") {
    return (fallback as (...a: unknown[]) => string)(...args);
  }
  return typeof fallback === "string" ? fallback : key;
}

function guardSize(bytes: number, locale: string): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(message(locale, "file.tooLarge", [MAX_FILE_BYTES / (1024 * 1024)]));
  }
}

async function documentFromFile(
  file: WebFileLike,
  locale: string,
  handle?: FsFileHandleLike,
): Promise<BackendDocument> {
  guardSize(file.size, locale);
  const content = await file.text();
  const doc: BackendDocument = {
    id: `web-doc-${nextHandleId}`,
    name: file.name,
    path: file.name,
    content,
    dirty: false,
    handle: null,
    kind: kindFromName(file.name),
  };
  if (handle) doc.handle = registerHandle(handle);
  return doc;
}

const ACCEPT_TYPES: NonNullable<PickerOptions["types"]> = [
  {
    description: "Markdown",
    accept: {
      "text/markdown": [".md", ".markdown", ".txt"],
      "text/x-typst": [".typ", ".typst"],
      "text/x-tex": [".tex", ".latex", ".ltx"],
    },
  },
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function pickViaFsa(
  mode: "open" | "save",
  suggestedName: string | undefined,
): Promise<FsFileHandleLike[]> {
  const win = window as PickerWindow;
  if (mode === "open") {
    return win.showOpenFilePicker!({ multiple: true, types: ACCEPT_TYPES });
  }
  return [await win.showSaveFilePicker!({ suggestedName, types: ACCEPT_TYPES })];
}

/** One-shot fallback for browsers without the File System Access API. */
function pickViaInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,.typ,.typst,.tex,.latex,.ltx";
    input.multiple = true;
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      resolve(files);
    };
    input.addEventListener("change", () =>
      finish(input.files ? Array.from(input.files) : []),
    );
    // A cancelled picker fires no change event; catch the focus that follows.
    window.addEventListener("focus", () => window.setTimeout(() => finish([]), 300), {
      once: true,
    });
    input.click();
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function writeThrough(handle: FsFileHandleLike, content: string): Promise<void> {
  if (!handle.createWritable) {
    throw new Error("read-only handle");
  }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export const webBackend: Backend = {
  async platform() {
    return "web";
  },

  async cliFiles() {
    // No command line on the web.
    return [];
  },

  async loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      if (raw.length > MAX_SESSION_BYTES) return null;
      const parsed = JSON.parse(raw) as {
        version?: number;
        docs?: Doc[];
        activeId?: string;
        split?: number;
      };
      if (
        parsed.version !== 3 ||
        !Array.isArray(parsed.docs) ||
        parsed.docs.length === 0
      ) {
        return null;
      }
      // Handles never survive a reload (no permission), so every restored
      // document comes back display-only, like Android's URIs.
      const docs = parsed.docs.map((d) => ({ ...d, handle: undefined }));
      const activeId = docs.some((d) => d.id === parsed.activeId)
        ? (parsed.activeId as string)
        : docs[0].id;
      const split = Math.min(80, Math.max(20, parsed.split ?? 50));
      return { docs, activeId, split };
    } catch (error) {
      console.warn("Could not restore web session", error);
      return null;
    }
  },

  async saveSession(input) {
    // Same shape the Rust side stores; handles stripped for the reason above.
    const payload = {
      version: 3,
      activeId: input.activeId,
      split: input.split,
      docs: input.docs.map(({ id, name, path, content, dirty, kind }) => ({
        id,
        name,
        path,
        content,
        dirty,
        kind,
      })),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  },

  async openFiles(locale) {
    try {
      if (!fsaAvailable()) {
        const files = await pickViaInput();
        const out: BackendDocument[] = [];
        for (const file of files) out.push(await documentFromFile(file, locale));
        return out;
      }
      const picked = await pickViaFsa("open", undefined);
      const out: BackendDocument[] = [];
      for (const handle of picked) {
        out.push(await documentFromFile(await handle.getFile(), locale, handle));
      }
      return out;
    } catch (error) {
      if (isAbort(error)) return [];
      throw error;
    }
  },

  async saveDocument(handle, content, locale) {
    const target = handles.get(handle);
    if (!target) {
      throw new Error(message(locale, "file.documentUnavailable"));
    }
    guardSize(content.length, locale);
    await writeThrough(target, content);
  },

  async saveAs(content, defaultName, locale) {
    guardSize(content.length, locale);
    if (!fsaAvailable()) {
      // No picker to cancel: downloading is the save. The document keeps no
      // handle, so further saves keep offering Save As instead of silently
      // re-downloading under the same name.
      downloadBlob(new Blob([content], { type: "text/plain" }), defaultName);
      return {
        id: `web-doc-${nextHandleId}`,
        name: defaultName,
        path: defaultName,
        content,
        dirty: false,
        handle: null,
        kind: kindFromName(defaultName),
      };
    }
    try {
      const [handle] = await pickViaFsa("save", defaultName);
      await writeThrough(handle, content);
      return {
        id: `web-doc-${nextHandleId}`,
        name: handle.name || defaultName,
        path: handle.name || defaultName,
        content,
        dirty: false,
        handle: registerHandle(handle),
        kind: kindFromName(defaultName),
      };
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  },

  async documentStat(handle) {
    const target = handles.get(handle);
    if (!target) return null;
    const file = await target.getFile();
    return { modifiedMs: file.lastModified, size: file.size };
  },

  async readDocument(handle) {
    const target = handles.get(handle);
    if (!target) return "";
    return (await target.getFile()).text();
  },

  async exportPdf(_defaultName, _locale, _paged, _pageWidthIn, _pageHeightIn) {
    // The browser's own print dialog offers "Save as PDF"; the print
    // stylesheet scopes the output to the preview pane. A Marp deck supplies
    // its own page size through an @page rule, so the dimensions are ignored.
    window.print();
  },

  async printDocument() {
    window.print();
  },

  async writePdfBytes(pdfBytes, defaultName, locale) {
    if (
      pdfBytes.length < 5 ||
      String.fromCharCode(...pdfBytes.slice(0, 5)) !== PDF_MAGIC
    ) {
      throw new Error(message(locale, "pdf.invalidPdf"));
    }
    downloadBlob(new Blob([pdfBytes.slice()], { type: "application/pdf" }), defaultName);
  },

  async writeHtmlFile(html, defaultName) {
    downloadBlob(new Blob([html], { type: "text/html" }), defaultName);
    return true;
  },

  async alert(messageText) {
    // Every caller surfaces the same text through the in-app notice first;
    // this is the durable copy. Mobile behaves the same way (non-blocking).
    console.error(`[meditor] ${messageText}`);
  },

  async exitApp() {
    window.close();
  },
};
