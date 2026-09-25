/**
 * The title an exported PDF carries.
 *
 * Every engine this application prints with takes the PDF's title from
 * `document.title` at the moment it prints: WebView2 by either of its routes,
 * WebKitGTK, and the browser behind the web build — measured in #189. The
 * application keeps `document.title` set to the tab's name, so every PDF was
 * titled with a file name, `notes.md`, even when the document says what it is
 * called. A front-matter `title:` is exactly that: the title block prints it,
 * the HTML export already takes it, and the PDF now does as well.
 */
import { frontMatterValue } from "./frontMatter";
import type { Doc } from "./types";

/**
 * The title a document's PDF should carry: its front-matter's `title:`, or
 * the tab's name, which is what every PDF carried before.
 *
 * Only Markdown has a front-matter, a Marp deck included, so a Typst or LaTeX
 * file keeps its name whatever its first lines look like. And not the HTML
 * export's `documentTitle`, which falls back further, to the first heading: a
 * document that names no title keeps the one its PDF always had.
 */
export function pdfTitle(doc: Pick<Doc, "kind" | "content" | "name">): string {
  const declared = doc.kind === "markdown" ? frontMatterValue(doc.content, "title") : null;
  return declared ?? doc.name;
}

/**
 * Run `print` with `document.title` set to `title`, and put the previous one
 * back once it settles, whichever way it does.
 *
 * `print` must not settle before the engine has read the title, and exporting
 * does not: the backend answers only once the PDF is written, or the web
 * build's print dialog has closed. The old title goes back only if the title
 * is still this one. Had the reader switched tabs meanwhile, the application
 * would already have set the right name, and restoring the old one would
 * overwrite it.
 */
export async function withDocumentTitle<T>(title: string, print: () => Promise<T>): Promise<T> {
  const previous = document.title;
  document.title = title;
  try {
    return await print();
  } finally {
    if (document.title === title) document.title = previous;
  }
}
