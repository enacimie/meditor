import type { EditorState } from "@codemirror/state";

/** Source lines, zero-based, from the first to the last inclusive. */
export type LineRange = { from: number; to: number };

/**
 * The lines the main selection covers, zero-based; null for a bare caret.
 *
 * A selection that ends at the very start of a line, as dragging over whole
 * lines leaves it, does not cover that line: nothing on it is selected.
 */
export function selectionLines(state: EditorState): LineRange | null {
  const { from, to } = state.selection.main;
  if (from === to) return null;
  const first = state.doc.lineAt(from);
  const end = state.doc.lineAt(to);
  const last = to === end.from && end.number > first.number ? end.number - 1 : end.number;
  return { from: first.number - 1, to: last - 1 };
}
