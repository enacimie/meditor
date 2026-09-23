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
