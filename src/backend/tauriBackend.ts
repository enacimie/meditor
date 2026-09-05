import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "../types";
import type { DocumentStat } from "../externalChange";
import type {
  Backend,
  SessionInput,
  SessionRestorePayload,
} from "./types";

/**
 * Desktop + Android implementation: a thin typed wrapper over the Rust
 * commands, preserving the exact payloads the frontend has always received.
 */
export const tauriBackend: Backend = {
  async platform() {
    try {
      return await invoke<string>("platform");
    } catch (error) {
      console.error("Could not read the platform", error);
      return null;
    }
  },

  cliFiles(locale: string): Promise<Doc[]> {
    return invoke<Doc[]>("cli_files", { locale });
  },

  loadSession(locale: string): Promise<SessionRestorePayload> {
    return invoke<SessionRestorePayload>("load_session", { locale });
  },

  saveSession(input: SessionInput, locale: string): Promise<void> {
    return invoke<void>("save_session", { input, locale });
  },

  openFiles(locale: string): Promise<Doc[]> {
    return invoke<Doc[]>("open_files", { locale });
  },

  saveDocument(handle: string, content: string, locale: string): Promise<void> {
    return invoke<void>("save_document", { handle, content, locale });
  },

  saveAs(content: string, defaultName: string, locale: string) {
    return invoke<Doc | null>("save_as", { content, defaultName, locale });
  },

  documentStat(handle: string, locale: string): Promise<DocumentStat> {
    return invoke<DocumentStat>("document_stat", { handle, locale });
  },

  readDocument(handle: string, locale: string): Promise<string> {
    return invoke<string>("read_document", { handle, locale });
  },

  imageStat(handle: string, relPath: string, locale: string): Promise<DocumentStat> {
    return invoke<DocumentStat>("image_stat", { handle, relPath, locale });
  },

  async readImage(
    handle: string,
    relPath: string,
    locale: string,
  ): Promise<Uint8Array | null> {
    // Raw bytes rather than base64: the command answers with an ArrayBuffer,
    // and encoding a photograph into a string to cross the IPC boundary would
    // cost a third more of everything for nothing.
    const buffer = await invoke<ArrayBuffer>("read_image", { handle, relPath, locale });
    return buffer && buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
  },

  writeImage(
    handle: string,
    name: string,
    bytes: Uint8Array,
    locale: string,
  ): Promise<{ relPath: string } | null> {
    // As an array, the way `write_pdf_bytes` sends its bytes: a Vec<u8> on the
    // Rust side, and the paste path already refuses anything over 10 MiB.
    return invoke<{ relPath: string } | null>("write_image", {
      handle,
      name,
      bytes: Array.from(bytes),
      locale,
    });
  },

  exportPdf(
    defaultName: string,
    locale: string,
    paged: boolean,
    pageWidthIn?: number,
    pageHeightIn?: number,
  ): Promise<void> {
    return invoke<void>("export_pdf", {
      defaultName,
      locale,
      paged,
      pageWidth: pageWidthIn ?? null,
      pageHeight: pageHeightIn ?? null,
    });
  },

  printDocument(locale: string): Promise<void> {
    return invoke<void>("print_document", { locale });
  },

  writePdfBytes(pdfBytes: Uint8Array, defaultName: string, locale: string): Promise<void> {
    // The IPC bridge wants plain numbers; Tauri serializes Uint8Array as an
    // array anyway, but keep the historical explicit conversion.
    return invoke<void>("write_pdf_bytes", {
      pdfBytes: Array.from(pdfBytes),
      defaultName,
      locale,
    });
  },

  writeHtmlFile(html: string, defaultName: string, locale: string): Promise<boolean> {
    return invoke<boolean>("write_html_file", { html, defaultName, locale });
  },

  alert(message: string, locale: string): Promise<void> {
    return invoke<void>("alert", { message, locale }).catch((error) => {
      console.error("Could not show native alert", error);
    });
  },

  exitApp(): Promise<void> {
    return invoke<void>("exit_app");
  },
};
