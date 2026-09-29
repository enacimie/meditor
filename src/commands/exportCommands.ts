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
import { compileLatexToPdf } from "../latexEngine";
import { LATEX_ENABLED } from "../latexSupport";
import { isMarpDocument } from "../marpDetect";
import { pdfMetadata } from "../pdfMetadata";
import { pdfTitle, withDocumentTitle } from "../pdfTitle";
import { getTypst } from "../typstEngine";
import { prepareTypst, typstMainName } from "../typstFiles";
import type { createOperationLock } from "./operationLock";

/** Exporting the document to PDF or HTML, and printing it. */
export function createExportCommands(
  scope: Pick<
    AppScope,
    "t" | "lang" | "platform" | "active" | "docView" | "pageMetrics" | "showNotice"
  >,
  { beginOperation, endOperation }: ReturnType<typeof createOperationLock>,
) {
  const { t, lang, platform, active, docView, pageMetrics, showNotice } = scope;

  async function exportPdf() {
    // Both backends export: the desktop prints the webview to a file, and the
    // web build hands the page to the browser's own dialog or downloads the
    // PDF a WASM engine produced. Asking `isTauri()` here left the web build's
    // menu entry doing nothing at all.
    if (!active) return;
    // Hiding the menu entry is not enough: Ctrl+E comes here directly. A
    // Markdown document, a Marp deck included, reaches PDF only through the
    // webview's printing, which a Mac or a phone does not have; say so rather
    // than hand Rust a request it can only refuse.
    if (active.kind === "markdown" && !canPrintNatively(platform)) {
      showNotice(t("op.pdfUnavailableHere"), "info");
      return;
    }
    if (!beginOperation("export")) return;
    try {
      const base = active.name.replace(/\.(md|markdown|txt|typ|typst|tex|latex|ltx)$/i, "") || t("doc.defaultExport");
      if (active.kind === "typst") {
        // Typst: compile to PDF in the Typst worker, the one the preview
        // uses, with the files beside the document as the preview had them,
        // then save through the backend.
        const { $typst } = await getTypst();
        const { input } = await prepareTypst(
          active.content,
          typstMainName(active.path),
          active.handle ? { handle: active.handle, locale: lang } : undefined,
        );
        const pdfBytes = await $typst.pdf(input);
        if (!pdfBytes) throw new Error("Typst compilation produced no output");
        const defaultName = `${base}.pdf`;
        await backend.writePdfBytes(pdfBytes, defaultName, lang);
      } else if (active.kind === "latex") {
        // Hiding the menu entry is not enough: Ctrl+E reaches this directly,
        // without passing through the menu. Without this guard the shortcut
        // would still hand the document to the very engine that was switched
        // off — and that engine's package endpoint is the reason it was.
        if (!LATEX_ENABLED) throw new Error(t("preview.latexDisabled"));
        // LaTeX: compile to PDF via SwiftLaTeX WASM, then save via Tauri dialog.
        const pdfBytes = await compileLatexToPdf(active.content);
        if (!pdfBytes) throw new Error("LaTeX compilation produced no output");
        const defaultName = `${base}.pdf`;
        await backend.writePdfBytes(pdfBytes, defaultName, lang);
      } else if (isMarpDocument(active.content)) {
        // Marp: one slide per page, and that page is the slide itself. Read the
        // real size from the rendered viewBox rather than assuming 16:9, since
        // a `size` directive or theme can change it.
        const { renderMarp } = await import("../marpEngine");
        const { html } = renderMarp(active.content);
        const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(html);
        const widthIn = viewBox ? Number(viewBox[1]) / 96 : 1280 / 96;
        const heightIn = viewBox ? Number(viewBox[2]) / 96 : 720 / 96;
        // Here and below, the PDF takes its title from `document.title` as it
        // prints: the document's own, when its front-matter names one, rather
        // than the tab's. The author, subject and keywords, which no engine
        // writes, go to the backend to add afterwards.
        await withDocumentTitle(pdfTitle(active), () =>
          backend.exportPdf(
            `${base}.pdf`,
            lang,
            true,
            widthIn,
            heightIn,
            undefined,
            pdfMetadata(active),
          ),
        );
      } else {
        await withDocumentTitle(pdfTitle(active), () =>
          backend.exportPdf(
            `${base}.pdf`,
            lang,
            // The paginated preview already draws its pages with their own
            // margins; asking the printer for margins too would inset every
            // page a second time and split it across two sheets.
            docView,
            undefined,
            undefined,
            // And the sheet it drew them on, which the printer has to agree
            // with or every page spills onto the next.
            pageMetrics.paper.id,
            pdfMetadata(active),
          ),
        );
      }
      showNotice(operationNoticeDone(t, "export"), "success");
    } catch (e) {
      showNotice(operationNoticeError(t, "export"), "error", 0);
      await showNativeAlert(operationErrorPrefix(t, "export") + String(e), lang);
    } finally {
      endOperation("export");
    }
  }

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

  return { exportPdf, printDocument, exportHtml };
}
