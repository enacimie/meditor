import type { Doc, DocKind } from "./types";

/**
 * First `Doc N` that no open document is already using.
 *
 * Derived from the documents on screen rather than kept in a counter, because a
 * counter only lives for one run of the app: a restored session brings back
 * `Doc 3` while the counter starts over at zero, so the next new tab is called
 * `Doc 1` — or takes a name that is already on a tab.
 */
export function nextUntitledName(docs: Doc[]): string {
  const taken = new Set(docs.map((d) => d.name));
  let n = 1;
  while (taken.has(`Doc ${n}`)) n += 1;
  return `Doc ${n}`;
}

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
