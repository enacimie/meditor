/**
 * Classification of an on-disk change to an open document.
 *
 * The watcher polls a cheap fingerprint (mtime + size) of every file-backed
 * document; when the fingerprint moves, the file is read once and this
 * classifier decides what the change means for the editor:
 *
 * - the bytes match the buffer: someone rewrote the same content — adopt the
 *   new fingerprint and stay quiet;
 * - the document is clean: reload silently, there is nothing to lose;
 * - the document is dirty: a real conflict, resolved by the user.
 */

/** Mirrors the Rust `DocumentStat` payload (`null` when unwatchable). */
export type DocumentStat = {
  modifiedMs?: number | null;
  size?: number | null;
} | null;

export type ExternalChangeVerdict =
  | { action: "none" }
  /** First sighting of this handle, or same-content rewrite: remember it. */
  | { action: "refresh-baseline" }
  /** Clean document, changed disk version: replace the buffer. */
  | { action: "reload"; diskContent: string }
  /** Dirty document, changed disk version: ask the user. */
  | { action: "conflict"; diskContent: string };

function sameStat(a: NonNullable<DocumentStat>, b: NonNullable<DocumentStat>): boolean {
  return a.modifiedMs === b.modifiedMs && a.size === b.size;
}

export function classifyExternalChange(args: {
  baseline: DocumentStat;
  current: DocumentStat;
  diskContent: string;
  bufferContent: string;
  dirty: boolean;
}): ExternalChangeVerdict {
  const { baseline, current, diskContent, bufferContent, dirty } = args;
  // Unwatchable or deleted: skip. Deletion surfaces on the next save, where
  // it can be explained instead of guessed at here.
  if (!current) return { action: "none" };
  if (!baseline || !sameStat(baseline, current)) {
    if (diskContent === bufferContent) return { action: "refresh-baseline" };
    return dirty ? { action: "conflict", diskContent } : { action: "reload", diskContent };
  }
  return { action: "none" };
}
