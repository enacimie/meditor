/**
 * Guards around paged.js pagination.
 *
 * paged.js measures the container it paginates into with
 * `element.offsetParent.getBoundingClientRect()` (chunker/layout.js), without
 * checking that `offsetParent` exists. Per spec it is `null` whenever the
 * element is detached from the document or sits inside a `display: none`
 * ancestor — which happens in normal use: zen mode hides the preview pane
 * (`.app.zen .pane:last-child`), and switching a tab to Typst/LaTeX unmounts
 * the paged container. If pagination is in flight at that moment, paged.js
 * throws `Cannot read properties of null (reading 'getBoundingClientRect')`.
 */

/** Whether paged.js can measure this container without throwing. */
export function isPaginatable(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el) return false;
  // Both conditions mirror what paged.js dereferences: a detached node and a
  // hidden ancestor each yield offsetParent === null.
  return el.isConnected && el.offsetParent !== null;
}
