/**
 * What a document's PDF says about it besides its title: the author, subject
 * and keywords its front-matter gives, in Pandoc's keys.
 *
 * No engine this application prints with writes them (measured in #189), so
 * `export_pdf` adds them to the PDF the engine printed (`pdf_meta.rs`). The
 * title travels another way, as `document.title` while the engine prints
 * (`pdfTitle.ts`), because every engine does write that one.
 */
import type { PdfMeta } from "./backend/types";
import { frontMatterList, frontMatterValue } from "./frontMatter";
import type { Doc } from "./types";

/**
 * The metadata for a document's PDF: only what its front-matter names.
 *
 * Joined as Pandoc joins them for LaTeX's `hyperref`: authors with "; ", so a
 * name that is "Surname, Name" stays one name, and keywords with ", ". Only
 * Markdown has a front-matter, a Marp deck included.
 */
export function pdfMetadata(doc: Pick<Doc, "kind" | "content">): PdfMeta {
  if (doc.kind !== "markdown") return {};
  const meta: PdfMeta = {};
  const authors = frontMatterList(doc.content, "author");
  if (authors) meta.author = authors.join("; ");
  const subject = frontMatterValue(doc.content, "subject");
  if (subject) meta.subject = subject;
  const keywords = frontMatterList(doc.content, "keywords");
  if (keywords) meta.keywords = keywords.join(", ");
  return meta;
}
