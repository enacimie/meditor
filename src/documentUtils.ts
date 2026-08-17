import type { Doc, DocKind } from "./types";

/** Resolve the editor language from a document path. */
export function kindFromPath(path: string): DocKind {
  if (/\.(typ|typst)$/i.test(path)) return "typst";
  if (/\.(tex|latex|ltx)$/i.test(path)) return "latex";
  return "markdown";
}

/**
 * Normalize payloads received from the native backend and old sessions.
 * Older payloads did not include `kind`, so infer it from the path when
 * possible and use Markdown for untitled documents.
 */
export function normalizeDoc(doc: Doc): Doc {
  const raw = doc as Doc & { kind?: unknown };
  const kind: DocKind =
    raw.kind === "typst" || raw.kind === "latex" || raw.kind === "markdown"
      ? raw.kind
      : raw.path
        ? kindFromPath(raw.path)
        : "markdown";
  return { ...doc, kind };
}
