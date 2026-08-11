import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { EditorView } from "codemirror";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(file.name);
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function insertImageAtCursor(view: EditorView, alt: string, dataUrl: string): void {
  const md = `![${alt}](${dataUrl})`;
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: md },
    selection: { anchor: sel.from + md.length },
  });
}

export type ImagePasteProps = {
  viewRef: React.RefObject<EditorView | null>;
};

export type ImagePasteAPI = {
  /** Whether the editor is currently being dragged over with image files. */
  dragOver: boolean;
  /** Whether an image is currently being read (for progress feedback). */
  busy: boolean;
  handleDragOver: (e: DragEvent<HTMLDivElement>) => void;
  handleDragEnter: (e: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: DragEvent<HTMLDivElement>) => void;
  handlePaste: (e: ClipboardEvent<HTMLDivElement>) => void;
};

export function useImagePaste({ viewRef }: ImagePasteProps): ImagePasteAPI {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragCounterRef = useRef(0);

  const insertImageFile = useCallback(async (view: EditorView, file: File) => {
    if (!isImageFile(file)) return;
    if (file.size > MAX_IMAGE_BYTES) {
      console.warn(`Image too large: ${file.name} (${(file.size / 1e6).toFixed(1)} MiB)`);
      return;
    }
    setBusy(true);
    try {
      // For images >1 MB, inject a placeholder so the user gets immediate
      // feedback before the base64 data URL is ready.
      if (file.size > 1_000_000) {
        const placeholder = `![${file.name}](Reading image…)`;
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: placeholder },
        });
      }
      const dataUrl = await readImageAsDataUrl(file);
      insertImageAtCursor(view, file.name, dataUrl);
    } catch (err) {
      console.error("Could not insert image:", err);
    } finally {
      setBusy(false);
    }
  }, []);

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const view = viewRef.current;
    if (!view) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void insertImageFile(view, file).then(() => view.focus());
        return;
      }
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const view = viewRef.current;
    if (!view) return;
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await insertImageFile(view, file);
    }
    view.focus();
  }

  return {
    dragOver,
    busy,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  };
}
