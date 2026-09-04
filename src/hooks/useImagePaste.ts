import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { EditorView } from "codemirror";
import { StateEffect, StateField, Transaction } from "@codemirror/state";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Above this, reading takes long enough that the wait needs to be visible. */
const PLACEHOLDER_THRESHOLD_BYTES = 1_000_000;

/** Why an image could not be inserted, for the caller to put in front of the user. */
export type ImagePasteError =
  | { kind: "tooLarge"; name: string; maxMiB: number }
  | { kind: "failed"; name: string };

/** An image being read, and the span of document its placeholder occupies. */
type PendingImage = { id: number; from: number; to: number };

const addPendingImage = StateEffect.define<PendingImage>();
const removePendingImage = StateEffect.define<number>();

/**
 * Where each in-flight image is going to land.
 *
 * Reading a file is asynchronous, and the document does not hold still while it
 * happens: the user keeps typing, and any edit before the insertion point moves
 * it. A position captured when the read started is stale by the time the bytes
 * arrive — which is how the placeholder used to be left behind, with the image
 * inserted beside it rather than over it.
 *
 * So the span is kept in the state and mapped through every change. The bias
 * arguments point the two ends outwards, so text typed at either edge of the
 * placeholder stays outside it and is not swallowed by the replacement.
 */
export const imagePlaceholderField = StateField.define<readonly PendingImage[]>({
  create() {
    return [];
  },
  update(pending, tr) {
    let next = pending;
    if (tr.docChanged && next.length > 0) {
      next = next.map((p) => {
        const from = tr.changes.mapPos(p.from, 1);
        const to = tr.changes.mapPos(p.to, -1);
        return { id: p.id, from, to: Math.max(from, to) };
      });
    }
    for (const effect of tr.effects) {
      if (effect.is(addPendingImage)) next = [...next, effect.value];
      else if (effect.is(removePendingImage))
        next = next.filter((p) => p.id !== effect.value);
    }
    return next;
  },
});

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

export type ImagePasteProps = {
  viewRef: React.RefObject<EditorView | null>;
  /** Told when an image could not be inserted, so the user hears about it. */
  onError?: (error: ImagePasteError) => void;
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

export function useImagePaste({ viewRef, onError }: ImagePasteProps): ImagePasteAPI {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragCounterRef = useRef(0);
  const seqRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const insertImageFile = useCallback(async (view: EditorView, file: File) => {
    if (!isImageFile(file)) return;
    if (file.size > MAX_IMAGE_BYTES) {
      onErrorRef.current?.({
        kind: "tooLarge",
        name: file.name,
        maxMiB: MAX_IMAGE_BYTES / (1024 * 1024),
      });
      return;
    }
    setBusy(true);
    const id = ++seqRef.current;
    try {
      // Replacing a selection is the user's own edit and belongs in the undo
      // history; the placeholder below deliberately does not, so it must not be
      // hidden inside a transaction they cannot undo.
      const selection = view.state.selection.main;
      if (selection.from !== selection.to) {
        view.dispatch({
          changes: { from: selection.from, to: selection.to },
          userEvent: "delete",
        });
      }

      // For an image big enough to keep the user waiting, show that something
      // is happening. A smaller one needs only the anchor, which is an empty
      // span at the same position.
      const from = view.state.selection.main.from;
      const placeholder =
        file.size > PLACEHOLDER_THRESHOLD_BYTES ? `![${file.name}](Reading image…)` : "";
      view.dispatch({
        changes: placeholder ? { from, insert: placeholder } : undefined,
        selection: { anchor: from + placeholder.length },
        effects: addPendingImage.of({ id, from, to: from + placeholder.length }),
      });

      const dataUrl = await readImageAsDataUrl(file);

      const pending = view.state.field(imagePlaceholderField).find((p) => p.id === id);
      if (!pending) {
        // The state was swapped underneath us — a tab switch during the read.
        onErrorRef.current?.({ kind: "failed", name: file.name });
        return;
      }
      if (pending.to > pending.from) {
        // Taking the placeholder out must stay out of the history. Recorded, it
        // becomes an undo step of its own, and the second Ctrl+Z after a paste
        // puts "Reading image…" back into the document instead of reaching the
        // edit before it. Its insertion, by contrast, is recorded like any
        // other change: history maps that event through this removal and drops
        // it, so it costs no undo step, and in the one case where the image is
        // abandoned — a tab switch mid-read — the stray text is undoable.
        view.dispatch({
          changes: { from: pending.from, to: pending.to },
          annotations: Transaction.addToHistory.of(false),
        });
      }
      const md = `![${file.name}](${dataUrl})`;
      view.dispatch({
        changes: { from: pending.from, insert: md },
        selection: { anchor: pending.from + md.length },
        effects: removePendingImage.of(id),
        userEvent: "input.paste",
      });
    } catch (err) {
      console.error("Could not insert image:", err);
      const pending = view.state.field(imagePlaceholderField).find((p) => p.id === id);
      if (pending) {
        view.dispatch({
          changes:
            pending.to > pending.from ? { from: pending.from, to: pending.to } : undefined,
          effects: removePendingImage.of(id),
          annotations: Transaction.addToHistory.of(false),
        });
      }
      onErrorRef.current?.({ kind: "failed", name: file.name });
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
