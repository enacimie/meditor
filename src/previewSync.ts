import type { LineRange } from "./editorSelection";

/**
 * The preview block that owns a source line: the one whose `data-line` is the
 * greatest not past it.
 *
 * Blocks are not in line order, so walking them in document order and
 * stopping at the first one past the line is not the same thing. Endnotes are
 * drawn at the end of the document with the line their definition is on:
 * from that line the walk stopped before reaching them, and from the last
 * line of the document it ran on into them instead of the last paragraph.
 *
 * Among blocks on the same line the last one wins, as it always has: the
 * innermost of nested blocks, and the second half of a paragraph paged.js
 * split. Before every block, the first one; with no blocks, nothing.
 */
export function blockForLine<T extends Element>(nodes: readonly T[], line: number): T | null {
  let best: T | null = null;
  let bestLine = -Infinity;
  for (const node of nodes) {
    const nodeLine = Number.parseInt(node.getAttribute("data-line") || "0", 10);
    if (nodeLine <= line && nodeLine >= bestLine) {
      best = node;
      bestLine = nodeLine;
    }
  }
  return best ?? nodes[0] ?? null;
}

/**
 * The preview blocks a selection covering source lines `from` to `to` spans:
 * the block that owns `from`, and every block that starts after it and no
 * later than `to`.
 *
 * Only the innermost are kept. A list item rather than the whole list, a row
 * rather than the whole table, the paragraphs rather than the quote around
 * them: the same block a click in the preview picks, so both directions mark
 * the same thing. A paragraph paged.js split across two pages is two blocks
 * with the same line, and both are kept. A selection that ends before the
 * first block (in the front matter, which is not drawn) covers none.
 *
 * `nodes` in document order, as `querySelectorAll` returns them: a block that
 * holds any of the others holds the one right after it.
 */
export function blocksForLines<T extends Element>(nodes: readonly T[], from: number, to: number): T[] {
  const lineOf = (node: T) => Number.parseInt(node.getAttribute("data-line") || "0", 10);
  const first = blockForLine(nodes, from);
  if (!first) return [];
  // Before every block, `first` is the first block, past `to`: none covered.
  const start = lineOf(first);
  const covered = nodes.filter((node) => lineOf(node) >= start && lineOf(node) <= to);
  return covered.filter((node, index) => !(index + 1 < covered.length && node.contains(covered[index + 1])));
}

/**
 * Put `className` on the blocks of `container` that `lines` covers, after
 * taking it off everything in `clearFrom`, and bring the first of them into
 * view when asked and none of them is in the window of its `.preview-scroll`.
 * Null lines only clear. Returns what was marked.
 */
export function markLines({
  clearFrom,
  container,
  lines,
  className,
  scroll,
}: {
  clearFrom: ReadonlyArray<HTMLElement | null>;
  container: HTMLElement | null;
  lines: LineRange | null;
  className: string;
  scroll: boolean;
}): HTMLElement[] {
  for (const root of clearFrom) {
    for (const el of Array.from(root?.querySelectorAll(`.${className}`) ?? [])) el.classList.remove(className);
  }
  if (!lines || !container) return [];
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-line]"));
  const marked = blocksForLines(nodes, lines.from, lines.to);
  for (const block of marked) block.classList.add(className);
  if (!scroll || !marked.length) return marked;
  const view = container.closest(".preview-scroll")?.getBoundingClientRect();
  const inView =
    !!view &&
    marked.some((block) => {
      const box = block.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    });
  if (!inView) marked[0].scrollIntoView({ behavior: "smooth", block: "center" });
  return marked;
}
