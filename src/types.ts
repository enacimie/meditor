/** Supported document languages. */
export type DocKind = "markdown" | "typst" | "latex";

/**
 * Core document model used throughout the app.
 *
 * - `id`: Unique client-side identifier (UUID or fallback).
 * - `name`: Display name shown in the tab bar.
 * - `path`: OS filesystem path (null for unsaved documents).
 * - `content`: Full source text of the document.
 * - `dirty`: Whether the document has unsaved changes.
 * - `handle`: Opaque registry handle assigned by the Rust backend for
 *   fast path resolution during save operations.
 * - `kind`: Document language ("markdown" or "typst"). Defaults to
 *   "markdown" when deserialising pre-v3 sessions.
 */
export type Doc = {
  id: string;
  name: string;
  path: string | null;
  content: string;
  dirty: boolean;
  handle?: string;
  kind: DocKind;
};
