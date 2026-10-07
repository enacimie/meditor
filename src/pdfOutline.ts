/**
 * The Document view's headings, as the PDF's bookmarks: for each, its level,
 * its text, the page it landed on and how far down that page.
 *
 * WebKitGTK writes no bookmarks (measured in #189), and WebView2 writes none
 * when `export_pdf` falls back to `PrintToPdf`. But the Document view knows
 * where every heading was laid out: paged.js built the very pages the printer
 * is handed, one sheet each. So the outline is read from them here and added
 * to the PDF after printing (`pdf_outline.rs`), wherever the engine left none.
 *
 * The same headings Chromium takes when it writes an outline itself, on
 * Windows: every heading on the pages, the front-matter's title among them,
 * and nothing from the page margins, where the running head is.
 */
import type { PdfOutlineEntry } from "./backend/types";

/** What a heading shows, without the footnote calls it may carry. */
function headingText(heading: HTMLElement): string {
  const copy = heading.cloneNode(true) as HTMLElement;
  for (const call of copy.querySelectorAll("sup.footnote-ref, .footnote-call, .footnote")) {
    call.remove();
  }
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The outline of the paged view inside `paged`, in reading order.
 *
 * `top` is how far down its page a heading starts, as a fraction of the
 * page's height, so the view's zoom on screen has no say in it: the backend
 * turns it into points on the sheet the PDF has.
 */
export function pdfOutline(paged: HTMLElement): PdfOutlineEntry[] {
  const entries: PdfOutlineEntry[] = [];
  const pages = paged.querySelectorAll<HTMLElement>(".pagedjs_page");
  pages.forEach((page, index) => {
    const box = page.getBoundingClientRect();
    for (const area of page.querySelectorAll<HTMLElement>(".pagedjs_page_content")) {
      for (const heading of area.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
        // The rest of a heading paged.js carried over to the next page is the
        // same heading, already counted where it starts.
        if (heading.hasAttribute("data-split-from")) continue;
        const title = headingText(heading);
        if (!title) continue;
        const offset = heading.getBoundingClientRect().top - box.top;
        const top = box.height > 0 ? Math.min(1, Math.max(0, offset / box.height)) : 0;
        entries.push({ level: Number(heading.tagName[1]), title, page: index, top });
      }
    }
  });
  return entries;
}
