import type { DocumentStat } from "./externalChange";
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

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * @param existing - documents already open, so an untitled one gets a name none
 * of them is using. Required rather than optional: getting it wrong produces
 * two tabs called the same thing.
 */
export function makeDoc(
  content: string,
  existing: Doc[],
  path: string | null = null,
  name?: string,
  kind?: DocKind,
): Doc {
  return {
    id: newId(),
    path,
    content,
    dirty: false,
    name: name ?? (path ? baseName(path) : nextUntitledName(existing)),
    kind: kind ?? (path ? kindFromPath(path) : "markdown"),
  };
}

/**
 * Start watching documents from the files their bytes came from.
 *
 * A backend hands the fingerprint over with the document — when it is
 * opened, when it comes back from the recents, and when a session restores
 * it — and this is where the watch learns it. Without a baseline the first
 * tick sees a buffer that differs from the disk the moment the writer types
 * a character, and cannot tell whose change it is: a document opened and
 * edited inside one poll interval would be accused of conflicting with
 * itself.
 *
 * Documents already being watched are left alone: a live fingerprint is
 * newer than anything a payload carries.
 */
export function seedWatchBaselines(
  stats: Map<string, DocumentStat>,
  documents: Doc[],
): void {
  for (const doc of documents) {
    if (!doc.handle || !doc.stat) continue;
    if (stats.has(doc.handle)) continue;
    stats.set(doc.handle, doc.stat);
  }
}
