/**
 * A stop to the pages paged.js adds for footnotes that never fit.
 *
 * When the notes on a page overflow their area and the page is the last one,
 * or ends at a forced break, paged.js 0.4.3 adds a page that holds nothing but
 * the rest of the notes (`clonePage`, from the `afterPageLayout` of its
 * footnote module) and lays that page out the same way. A note judged not to
 * fit anywhere is therefore moved to a new page, then to another, without
 * end. Every step waits only on promises that are already resolved, so the
 * page never gets back to its event loop: the preview freezes, and the
 * application with it. That happened on the CI's Windows and macOS runners
 * (see `.pagedjs_footnote_content` in paged.css), which gave up after adding
 * hundreds of pages, and in one run more than a thousand.
 *
 * So a page of notes that kept none of them is not followed by another: it
 * did no better than the page before it, and the next one would do no better
 * either. A run of such pages is also cut at a length no real document
 * reaches, in case one is somehow making progress this cannot see. Either way
 * it is said once, in the console.
 */

/** The longest run of note pages allowed after one page of the document. */
export const MAX_NOTE_PAGES_IN_A_ROW = 20;

type Page = { element?: HTMLElement };
type Chunker = { pages: Page[]; clonePage(page: Page): Promise<unknown> };

/**
 * Wrap `chunker.clonePage` so that a run of note pages ends.
 *
 * Exported for tests; `limitFootnotePages` installs it on every chunker
 * paged.js creates.
 */
export function stopRunawayNotePages(chunker: Chunker, limit = MAX_NOTE_PAGES_IN_A_ROW): void {
  const clonePage = chunker.clonePage.bind(chunker);
  // How many note pages each added page is from the page of the document it
  // continues. The document's own pages are not in it.
  const runs = new WeakMap<Page, number>();
  let told = false;
  chunker.clonePage = (page) => {
    const run = runs.get(page);
    const next = (run ?? 0) + 1;
    const keptNothing = run !== undefined && !holdsNotes(page);
    if (keptNothing || next > limit) {
      if (!told) {
        told = true;
        console.warn("paged.js: stopped adding pages for footnotes that do not fit");
      }
      return Promise.resolve();
    }
    const added = clonePage(page);
    // paged.js appends the new page to its list before its first await.
    const created = chunker.pages[chunker.pages.length - 1];
    if (created && created !== page) runs.set(created, next);
    return added;
  };
}

/** Whether any note text is left in the page's note area. */
function holdsNotes(page: Page): boolean {
  const notes = page.element?.querySelector(".pagedjs_footnote_inner_content");
  return !!notes?.textContent?.trim();
}

let installed = false;

/** Put the stop on every paged.js Previewer created from now on. */
export function limitFootnotePages(
  paged: Pick<typeof import("pagedjs"), "Handler" | "registerHandlers">,
): void {
  if (installed) return;
  installed = true;
  class FootnotePageLimit extends paged.Handler {
    constructor(chunker: Chunker, polisher: unknown, caller: unknown) {
      super(chunker, polisher, caller);
      stopRunawayNotePages(chunker);
    }
  }
  paged.registerHandlers(FootnotePageLimit);
}
