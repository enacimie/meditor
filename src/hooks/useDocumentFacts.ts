import { useMemo } from "react";
import { parseHeadings, type Heading } from "../components/outlineUtils";
import { documentLanguage } from "../documentLanguage";
import type { EditorPreferences } from "../editorPreferences";
import { frontMatterValue } from "../frontMatter";
import { isMarpDocument } from "../marpDetect";
import {
  paperById,
  paperByName,
  marginByName,
  pageMetrics as metricsFor,
} from "../pageSetup";
import type { Doc } from "../types";

/** Stable empty list, so a closed outline does not re-render its consumers. */
const EMPTY_HEADINGS: Heading[] = [];

/**
 * What the document on screen says about itself: its outline, whether it is
 * a slide deck, and the paper, margin and language it asks for.
 */
export function useDocumentFacts(
  active: Doc | undefined,
  outlineOpen: boolean,
  editorPrefs: EditorPreferences,
) {
  // Parsing runs over the whole document, so keep it off the keystroke path:
  // only the outline panel consumes this, and it is closed by default.
  const activeContent = active?.content ?? "";
  const activeKind = active?.kind ?? "markdown";
  const headings = useMemo(
    () => (outlineOpen ? parseHeadings(activeContent, activeKind) : EMPTY_HEADINGS),
    [outlineOpen, activeContent, activeKind],
  );
  // Typst and LaTeX currently do not expose stable source locations in their
  // rendered output, so their preview↔editor sync controls must not pretend
  // to work. Markdown provides data-line metadata for both directions.
  const markdownSyncAvailable = (active?.kind ?? "markdown") === "markdown";
  // A Markdown deck that opts into Marp renders as slides, so the paged
  // Document/Web toggle and the A4 paper background do not apply to it.
  const isActiveMarp = useMemo(
    () => markdownSyncAvailable && isMarpDocument(activeContent),
    [markdownSyncAvailable, activeContent],
  );

  /*
   * The paper this document asks for, if it asks.
   *
   * `papersize` in the front-matter, which is Pandoc's key and reaches this
   * application by the same route `title` and `numbersections` already do.
   * The document wins over the preference because the preference is about the
   * reader — the paper in their printer — and this is about the document: a
   * thesis submitted on Letter is on Letter wherever it is opened, and being
   * repaginated by whoever opens it is the failure, not the feature.
   *
   * Markdown only. Typst and LaTeX describe their own page in their own
   * syntax, and a YAML block is not part of either language.
   */
  const declaredPaper = useMemo(
    () => (markdownSyncAvailable ? frontMatterValue(activeContent, "papersize") : null),
    [markdownSyncAvailable, activeContent],
  );

  /*
   * And the margin it asks for, by the same route and for the same reason.
   *
   * `margin: 1in` is what a document written to a house style says, and it
   * has to travel with the document rather than depend on who opens it.
   */
  const declaredMargin = useMemo(
    () => (markdownSyncAvailable ? frontMatterValue(activeContent, "margin") : null),
    [markdownSyncAvailable, activeContent],
  );

  /*
   * And the language it is written in: `lang`, Pandoc's key once more.
   *
   * Hyphenation, the spell checker and a screen reader all go by the `lang` of
   * the text in front of them, and that used to be the interface's whatever
   * the document was in: an English document opened in a Spanish interface
   * was marked as Spanish. What the document says wins, for the reason above.
   * One that says nothing, or something that is not a language, follows the
   * interface as before.
   *
   * The same two steps as the paper: the string first, so the object below is
   * rebuilt only when the front-matter changes and not on every keystroke.
   */
  const declaredLanguage = useMemo(
    () => (markdownSyncAvailable ? frontMatterValue(activeContent, "lang") : null),
    [markdownSyncAvailable, activeContent],
  );
  const docLanguage = useMemo(() => documentLanguage(declaredLanguage), [declaredLanguage]);

  /*
   * The sheet everything paginated agrees on: the Document view, the
   * measuring passes behind it, the HTML export and the printer. One value,
   * because a document laid out for one paper and printed on another does not
   * shift, it spills.
   *
   * Two memos and not one, and that is deliberate: the inner one runs over
   * the document on every keystroke, and the outer one depends on the *name*
   * it found. So typing produces a new string only when the front-matter
   * itself changes, and the metrics object — which repaginating keys off —
   * stays identical through a paragraph.
   */
  const pageMetrics = useMemo(
    () =>
      metricsFor(
        paperByName(declaredPaper) ?? paperById(editorPrefs.paperSize),
        marginByName(declaredMargin) ?? editorPrefs.pageMarginMm,
      ),
    [declaredPaper, declaredMargin, editorPrefs.paperSize, editorPrefs.pageMarginMm],
  );

  return {
    activeContent,
    activeKind,
    headings,
    markdownSyncAvailable,
    isActiveMarp,
    docLanguage,
    pageMetrics,
  };
}
