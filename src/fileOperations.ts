/**
 * The file operations a person starts — open, save, export — and the words
 * the application uses for each while it runs, when it is done and when it
 * fails. Moved out of App.tsx unchanged.
 */
import type { MutableRefObject } from "react";
import { backend } from "./backend";
import type { useTranslation } from "./i18n/I18nProvider";

export type FileOperation = "open" | "save" | "saveAs" | "export" | "exportHtml" | "reload";

export async function showNativeAlert(message: string, locale: string): Promise<void> {
  await backend.alert(message, locale);
}

export function isOperationBusy(ref: MutableRefObject<FileOperation | null>): boolean {
  return ref.current !== null;
}

export function operationNotice(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.opening");
  if (op === "reload") return t("op.reloading");
  if (op === "save") return t("op.saving");
  if (op === "saveAs") return t("op.savingAs");
  if (op === "exportHtml") return t("op.exportingHtml");
  return t("op.exporting");
}

export function operationNoticeDone(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.opened");
  if (op === "export") return t("op.pdfExported");
  if (op === "exportHtml") return t("op.htmlExported");
  return t("op.saved");
}

export function operationNoticeError(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.openError");
  if (op === "reload") return t("op.reloadError");
  if (op === "export") return t("op.exportError");
  if (op === "exportHtml") return t("op.exportHtmlError");
  return t("op.saveError");
}

export function operationErrorPrefix(t: ReturnType<typeof useTranslation>["t"], op: FileOperation): string {
  if (op === "open") return t("op.openErrorPrefix");
  if (op === "reload") return t("op.reloadErrorPrefix");
  if (op === "export") return t("op.exportErrorPrefix");
  if (op === "exportHtml") return t("op.exportHtmlErrorPrefix");
  return t("op.saveErrorPrefix");
}
