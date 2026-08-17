/**
 * Session serialization and validation.
 *
 * The actual session persistence is handled by the Rust backend
 * (load_session / save_session commands). These functions serve as:
 *
 * - `serializeSession`: Canonical client-side representation before sending
 *   session data to the Rust backend.
 * - `parseSession`: Compatibility parser for browser-only mode and legacy
 *   sessions written before document kinds were persisted.
 */

import { kindFromPath } from "./documentUtils";
import type { Doc, DocKind } from "./types";

export const SESSION_VERSION = 3;
const LEGACY_SESSION_VERSION = 2;
const MAX_SESSION_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export type SessionData = {
  version: typeof SESSION_VERSION;
  docs: Doc[];
  activeId: string;
  split: number;
};

function isDoc(value: unknown): value is Doc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<Doc>;
  return (
    typeof doc.id === "string" &&
    typeof doc.name === "string" &&
    (typeof doc.path === "string" || doc.path === null) &&
    typeof doc.content === "string" &&
    typeof doc.dirty === "boolean"
  );
}

export function parseSession(raw: string): SessionData | null {
  try {
    if (raw.length > MAX_SESSION_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const data = value as Partial<SessionData> & { version?: unknown };
    if (
      data.version !== undefined &&
      data.version !== SESSION_VERSION &&
      data.version !== LEGACY_SESSION_VERSION
    ) {
      return null;
    }
    if (!Array.isArray(data.docs)) return null;
    const ids = new Set<string>();
    const docs = data.docs
      .filter(isDoc)
      .filter((doc) => {
        if (ids.has(doc.id) || doc.content.length > MAX_DOCUMENT_BYTES) return false;
        ids.add(doc.id);
        return true;
      })
      .map((doc) => {
        const rawKind = (doc as Record<string, unknown>).kind;
        const kind: DocKind =
          rawKind === "typst" || rawKind === "latex" || rawKind === "markdown"
            ? rawKind
            : doc.path
              ? kindFromPath(doc.path)
              : "markdown";
        return { ...doc, kind } as Doc;
      });
    if (!docs.length) return null;
    const activeId =
      typeof data.activeId === "string" && docs.some((doc) => doc.id === data.activeId)
        ? data.activeId
        : docs[0].id;
    const split =
      typeof data.split === "number" && Number.isFinite(data.split)
        ? Math.max(20, Math.min(80, data.split))
        : 50;
    return { version: SESSION_VERSION, docs, activeId, split };
  } catch {
    return null;
  }
}

export function serializeSession(
  docs: Doc[],
  activeId: string,
  split: number,
): string {
  const data: SessionData = {
    version: SESSION_VERSION,
    docs,
    activeId,
    split: Math.max(20, Math.min(80, split)),
  };
  return JSON.stringify(data);
}
