/**
 * Ticking a task off from the preview.
 *
 * `- [ ] something` renders as a real, enabled checkbox, and until now
 * clicking it did nothing that lasted: the box ticked in the DOM, the document
 * was never touched, and the next repaint — which happens on any keystroke —
 * put it back. An interactive control that silently discards what you did to
 * it is worse than one that is visibly disabled.
 *
 * The document is the source of truth, so the click has to reach the Markdown.
 * This is the part that says where in the line the box is and what goes in it;
 * the editor turns that into a one-character change, which is what keeps the
 * undo history and the cursor where the reader left them.
 */

/**
 * A task marker at the start of a list item.
 *
 * Deliberately anchored and deliberately narrow: the leading whitespace of a
 * nested item, then the bullet or the number, then the box. Matching `[ ]`
 * anywhere on the line would tick a checkbox because the prose happened to
 * mention one.
 */
const TASK_MARKER = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])\]/;

/** The offset of a task's box within its line, and what to write into it. */
export type TaskToggle = {
  /** Characters from the start of the line to the box's contents. */
  at: number;
  /** The single character to put there. */
  insert: string;
};

/**
 * Where to write to flip the task on `line`, or null when it holds none.
 *
 * Null rather than a no-op change, so the caller can skip an edit that would
 * otherwise land in the undo history and mark the document dirty for nothing.
 */
export function taskToggleOnLine(line: string): TaskToggle | null {
  const match = TASK_MARKER.exec(line);
  if (!match) return null;
  const [, prefix, state] = match;
  // `x` lower case whichever case was there: `[X]` is valid Markdown and this
  // has to write one of the two, but there is no reason to preserve a shout.
  return { at: prefix.length, insert: state.toLowerCase() === "x" ? " " : "x" };
}
