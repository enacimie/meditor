import type { Doc } from "../types";
import type { DocumentStat } from "../externalChange";

/**
 * Payload produced by open/save-as; mirrors the Rust `NativeDocument` shape
 * so the frontend keeps a single normalization path.
 */
export type BackendDocument = Doc;

/** What save_session sends up; handles ride along untouched. */
export type SessionInput = {
  docs: Array<
    Pick<Doc, "id" | "name" | "path" | "content" | "dirty" | "handle" | "kind">
  >;
  activeId: string;
  split: number;
};

export type SessionRestorePayload = {
  docs: Doc[];
  activeId: string;
  split: number;
} | null;

/**
 * The native surface the app needs, nothing more.
 *
 * Two implementations exist: `tauriBackend` bridges to the Rust commands and
 * serves desktop + Android; `webBackend` reimplements the same contract with
 * browser APIs and serves the static web build. Call sites never branch on
 * platform themselves — they ask this object.
 */
export type Backend = {
  /** OS name ("linux", "windows", ...) or "web"; never rejects. */
  platform(): Promise<string | null>;
  /** Documents named on the command line; always empty outside desktop. */
  cliFiles(locale: string): Promise<Doc[]>;
  loadSession(locale: string): Promise<SessionRestorePayload>;
  saveSession(input: SessionInput, locale: string): Promise<void>;
  /** Native picker; empty array when cancelled. */
  openFiles(locale: string): Promise<Doc[]>;
  saveDocument(handle: string, content: string, locale: string): Promise<void>;
  /** Native picker; null when cancelled. */
  saveAs(
    content: string,
    defaultName: string,
    locale: string,
  ): Promise<Doc | null>;
  documentStat(handle: string, locale: string): Promise<DocumentStat>;
  readDocument(handle: string, locale: string): Promise<string>;
  exportPdf(
    defaultName: string,
    locale: string,
    paged: boolean,
    /** Exact page size in inches — Marp slides — instead of the default A4. */
    pageWidthIn?: number,
    pageHeightIn?: number,
  ): Promise<void>;
  printDocument(locale: string): Promise<void>;
  writePdfBytes(
    pdfBytes: Uint8Array,
    defaultName: string,
    locale: string,
  ): Promise<void>;
  writeHtmlFile(html: string, defaultName: string, locale: string): Promise<boolean>;
  alert(message: string, locale: string): Promise<void>;
  exitApp(): Promise<void>;
};

export type { DocumentStat };
