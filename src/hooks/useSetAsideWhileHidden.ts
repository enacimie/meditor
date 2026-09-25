import { useLayoutEffect, type RefObject } from "react";

/**
 * Keep an element's content out of the page while it is hidden, and put the
 * same nodes back before it is painted again.
 *
 * Hidden is not gone. An element under `display: none` still holds its ids,
 * and a browser resolves an id to the first element that has it: a hidden
 * copy of a document ahead of the one on show takes its links, the PDF's
 * destinations and its diagrams' arrowheads away from it.
 *
 * Set aside in a fragment rather than emptied, the content comes back as it
 * was left, and so does the height the scroll position stands on. Emptied, a
 * view came back blank until it was drawn again, and scrolled to the top.
 */
export function useSetAsideWhileHidden(
  ref: RefObject<HTMLElement | null>,
  hidden: boolean,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!hidden || !el) return;
    const aside = document.createDocumentFragment();
    aside.append(...el.childNodes);
    return () => el.append(aside);
  }, [ref, hidden]);
}
