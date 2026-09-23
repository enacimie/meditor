/**
 * Footnotes at the foot of the page they are called on, in the Document view.
 *
 * markdown-it-footnote gathers every note into a list at the end of the
 * document. That suits a web page, and it is where the Document view left
 * them too: a note called on page 1 of 7 was read on page 7. paged.js can set
 * a note at the foot of its page (`float: footnote` in paged.css), but only an
 * element already standing where the note is called — it moves that element
 * into the page's note area and puts a call in its place. And the element has
 * to be inline: a note called in a paragraph lives inside that paragraph, and
 * the paginated view re-parses its HTML, where a block inside a `<p>` would
 * split it.
 *
 * So before pagination each note that can stand in line becomes a
 * `span.footnote` right after its first call, and leaves the list. The number
 * is markdown-it's, written into the note and the calls, so a note cited twice
 * is "1" both times; paged.js's own counters are hidden by paged.css. The
 * number carries the `fn<n>` id, since paged.js renames the note it moves, so
 * a call still links to its note. A note that cannot stand in line — with a
 * list or more than one paragraph in it, or called from another note, from a
 * heading or from inside a link — stays at the end with its number kept, and
 * so does one too long for a page (MAX_LIFTED_NOTE_CHARS, below).
 *
 * The Web view and the exported HTML have no pages, so they keep the list.
 */

/*
 * The longest note lifted to the foot of a page, in characters. paged.js
 * 0.4.3 prints a note that does not fit on one page twice over — measured:
 * 1,400 words, every one of them on two pages — while one that does fit is
 * placed whole, moving its call to the next page if it must. 3,000 characters
 * of prose fit on the smallest text block the preferences allow (Letter with
 * 35 mm margins, measured), so a longer note stays at the end instead.
 */
export const MAX_LIFTED_NOTE_CHARS = 3000;

export function footnotesToCalls(root: ParentNode): void {
  const section = root.querySelector<HTMLElement>("section.footnotes");
  if (!section) return;
  const list = section.querySelector<HTMLOListElement>("ol.footnotes-list");
  if (!list) return;

  for (const item of Array.from(list.children)) {
    if (!(item instanceof HTMLLIElement) || !item.classList.contains("footnote-item")) continue;
    const number = /^fn(\d+)$/.exec(item.id)?.[1];
    if (!number) continue;
    // Keep the number whatever happens to the notes before it: with some of
    // them gone, the list would count the rest from one again.
    item.value = Number(number);

    const calls = callsTo(root, item.id);
    const text = inlineText(item);
    if (!text || (text.textContent ?? "").length > MAX_LIFTED_NOTE_CHARS) continue;
    if (calls.length === 0 || !calls.every((call) => canFloat(call, section))) continue;

    for (const call of calls) {
      const link = call.querySelector("a");
      if (link) link.textContent = number;
      call.classList.add("footnote-call");
    }

    const note = calls[0].ownerDocument.createElement("span");
    note.className = "footnote";
    const line = text.getAttribute("data-line");
    if (line !== null) note.setAttribute("data-line", line);
    const marker = note.ownerDocument.createElement("sup");
    marker.className = "footnote-number";
    marker.id = item.id;
    marker.textContent = number;
    note.append(marker, " ");
    for (const child of Array.from(text.childNodes)) {
      if (child instanceof Element && child.classList.contains("footnote-backref")) continue;
      note.append(child);
    }
    trimEnd(note);
    calls[0].after(note);
    item.remove();
  }

  if (list.children.length === 0) {
    const separator = section.previousElementSibling;
    if (separator?.matches("hr.footnotes-sep")) separator.remove();
    section.remove();
  }
}

/** Every call to the note with id `id`, in document order. */
function callsTo(root: ParentNode, id: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("sup.footnote-ref")).filter(
    (sup) => sup.querySelector("a")?.getAttribute("href") === `#${id}`,
  );
}

/** The note's only paragraph, if a paragraph is all it is. */
function inlineText(item: HTMLLIElement): HTMLParagraphElement | null {
  const blocks = Array.from(item.children).filter(
    (child) => !child.classList.contains("footnote-backref"),
  );
  if (blocks.length !== 1) return null;
  const [block] = blocks;
  return block instanceof HTMLParagraphElement ? block : null;
}

/** Whether a note can be lifted to the foot of the page from this call. */
function canFloat(call: HTMLElement, notes: HTMLElement): boolean {
  // Called from another note: from the list, or from one already lifted out
  // of it, which is how a note called inside note 3 reaches this check.
  if (notes.contains(call) || call.closest("span.footnote")) return false;
  if (call.closest("h1, h2, h3, h4, h5, h6")) return false;
  const link = call.parentElement?.closest("a");
  return !link;
}

/** Drop the whitespace a removed back-link leaves at the end of a note. */
function trimEnd(note: HTMLElement): void {
  let last = note.lastChild;
  while (last && last.nodeType === Node.TEXT_NODE) {
    const trimmed = (last.textContent ?? "").replace(/\s+$/, "");
    if (trimmed) {
      last.textContent = trimmed;
      return;
    }
    const previous = last.previousSibling;
    last.remove();
    last = previous;
  }
}
