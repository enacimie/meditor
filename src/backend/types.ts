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
  /**
   * Fingerprint of an image beside a document, or null when there is none to
   * read. Null is also the answer wherever relative images cannot work at all
   * — an Android content URI has no directory around it, and a web file
   * handle has no parent — so a caller never has to ask which platform it is
   * on.
   */
  imageStat(handle: string, relPath: string, locale: string): Promise<DocumentStat>;
  /** The bytes of an image beside a document; null when there are none. */
  readImage(handle: string, relPath: string, locale: string): Promise<Uint8Array | null>;
  /**
   * Write an image into `assets/` beside a document, and say what to link to.
   *
   * `name` is a proposal, not a path: the backend decides the final name and
   * refuses anything that is not an image. Null where there is nowhere to
   * write — a document that has never been saved, an Android content URI, the
   * web build — and the caller falls back to embedding the image instead.
   */
  writeImage(
    handle: string,
    name: string,
    bytes: Uint8Array,
    locale: string,
  ): Promise<{ relPath: string } | null>;
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
