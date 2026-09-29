import type { AppScope } from "../appScope";
import { backend } from "../backend";
import {
  showNativeAlert,
  operationNoticeDone,
  operationNoticeError,
  operationErrorPrefix,
} from "../fileOperations";
import { canPrintNatively } from "../hooks/usePlatform";
import { isRtl } from "../i18n/translations";
import { isMarpDocument } from "../marpDetect";
import type { createOperationLock } from "./operationLock";

/** Printing the document, and exporting it to HTML. */
export function createExportCommands(
  scope: Pick<
    AppScope,
    "t" | "lang" | "platform" | "active" | "docView" | "pageMetrics" | "showNotice"
  >,
  { beginOperation, endOperation }: ReturnType<typeof createOperationLock>,
) {
  const { t, lang, platform, active, docView, pageMetrics, showNotice } = scope;

  async function printDocument() {
    // Ctrl+P is the only way here, and where the webview cannot print it
    // would only pass on Rust's refusal.
    if (!canPrintNatively(platform)) {
      showNotice(t("op.printUnavailableHere"), "info");
      return;
    }
    try {
      // A Marp deck is a stack of slides, each already its own page; the
      // paginated view draws pages with their own margins. Either way the
      // printer must not inset them a second time.
      const paged = docView || (!!active && isMarpDocument(active.content));
      /*
       * The paper only for the documents this application lays out.
       *
       * `pageMetrics` describes the Document view's sheet, and a Typst or
       * LaTeX document is not on it: those compose their own page, from their
       * own `#set page` or `geometry`, and the preview shows what the engine
       * produced. Handing the printer a paper the document never chose is how
       * a Typst file written for A4 came to be printed on Letter — 17 mm
       * shorter, so every page spilled onto a second. On Linux, at least;
       * Windows shows its own dialog and ignores what it is told here, which
       * is why this went unnoticed.
       */
      const paper = (active?.kind ?? "markdown") === "markdown" ? pageMetrics.paper.id : undefined;
      await backend.printDocument(lang, paged, paper);
    } catch (e) {
      await showNativeAlert(String(e), lang);
    }
  }

  async function exportHtml() {
    // Markdown only: Typst and LaTeX render through their own engines, which
    // produce PDF rather than the HTML the preview builds.
    if (!active || active.kind !== "markdown") return;
    if (!beginOperation("exportHtml")) return;
    try {
      const base =
        active.name.replace(/\.(md|markdown|txt)$/i, "") || t("doc.defaultExport");
      // A Marp deck exports as stacked slides; anything else as a document.
      const html = isMarpDocument(active.content)
        ? await (
            await import("../exportMarpHtml")
          ).exportMarpToHtml(active.content, {
            fileName: base,
            lang,
            rtl: isRtl(lang),
            t,
          })
        : await (
            await import("../exportHtml")
          ).exportMarkdownToHtml(active.content, {
            fileName: base,
            lang,
            rtl: isRtl(lang),
            t,
            docHandle: active.handle ?? null,
            metrics: pageMetrics,
          });
      const saved = await backend.writeHtmlFile(html, `${base}.html`, lang);
      // Cancelling the save dialog is not a failure, but it is not a success
      // either: announcing "HTML exported" with no file is worse than silence.
      if (saved) showNotice(operationNoticeDone(t, "exportHtml"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "exportHtml"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "exportHtml") + String(e), lang);
    } finally {
      endOperation("exportHtml");
    }
  }

  return { printDocument, exportHtml };
}
