import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { EditorView } from "codemirror";
import { StateEffect, StateField, Transaction } from "@codemirror/state";
import { backend } from "../backend";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Above this, reading takes long enough that the wait needs to be visible. */
const PLACEHOLDER_THRESHOLD_BYTES = 1_000_000;

/** Why an image could not be inserted, for the caller to put in front of the user. */
export type ImagePasteError =
  | { kind: "tooLarge"; name: string; maxMiB: number }
  | { kind: "failed"; name: string }
  /** Could not be written beside the document, so it went in whole instead. */
  | { kind: "notStored"; name: string };

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

/** The bytes of a file, for handing to the backend. */
function readFileBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

/**
 * A name for a pasted image.
 *
 * A file dragged in has one worth keeping. A screenshot off the clipboard
 * arrives as `image.png` from every browser, so a folder of them would be
 * `image.png`, `image-1.png`, `image-2.png` with nothing to tell them apart;
 * those get the date and time instead.
 */
function proposeName(file: File): string {
  const extension = (file.name.split(".").pop() ?? "png").toLowerCase();
  const generic = !file.name || /^image[.][a-z0-9]+$/i.test(file.name);
  if (!generic) return file.name;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `image-${stamp}.${extension}`;
}

/** A relative path as a Markdown link target: POSIX, and escaped. */
function linkTarget(relPath: string): string {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export type ImagePasteProps = {
  viewRef: React.RefObject<EditorView | null>;
  /**
   * The open document, so a pasted image can be written beside it. Null for
   * one that has never been saved, and the image is embedded instead.
   */
  docHandle?: string | null;
  /** The interface language, for the messages the backend produces. */
  locale?: string;
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

export function useImagePaste({
  viewRef,
  docHandle = null,
  locale = "en",
  onError,
}: ImagePasteProps): ImagePasteAPI {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragCounterRef = useRef(0);
  const seqRef = useRef(0);
  // Read at paste time rather than captured: the callback below is built once
  // and would otherwise hold the document that was open when it was.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const docHandleRef = useRef(docHandle);
  docHandleRef.current = docHandle;
  const localeRef = useRef(locale);
  localeRef.current = locale;

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

      /*
       * Beside the document if there is a document to be beside, and inside
       * it otherwise. A `.md` carrying its pictures as base64 is portable and
       * enormous — a couple of screenshots outweigh the prose several times
       * over, in the file, in the session snapshot and in every export — so a
       * saved document gets real files and a link. An unsaved one, an Android
       * content URI and the web build have nowhere to put them, and keep the
       * old behaviour rather than nagging about it.
       */
      let markdownTarget: string | null = null;
      let stem = file.name;
      const handle = docHandleRef.current;
      if (handle) {
        try {
          const written = await backend.writeImage(
            handle,
            proposeName(file),
            await readFileBytes(file),
            localeRef.current,
          );
          if (written) {
            markdownTarget = linkTarget(written.relPath);
            stem = written.relPath.split("/").pop() ?? file.name;
          }
        } catch (error) {
          // Disk full, permission refused, a name the backend would not take.
          // The paste still happens — losing the image would be worse than a
          // large document — but the user is told why the file is not there.
          console.error("Could not store the image beside the document:", error);
          onErrorRef.current?.({ kind: "notStored", name: file.name });
        }
      }
      const dataUrl = markdownTarget ?? (await readImageAsDataUrl(file));

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
      const md = `![${stem}](${dataUrl})`;
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
