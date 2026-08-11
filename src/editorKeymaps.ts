import { keymap, EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** Markdown tokens that auto-close in pairs: *, _, ~, `, $ */
export const MARKDOWN_PAIRS: [string, string][] = [
  ["`", "`"],
  ["*", "*"],
  ["_", "_"],
  ["~", "~"],
  ["$", "$"],
];

/**
 * Build a CodeMirror keymap that auto-closes markdown formatting pairs.
 * - No selection, char after cursor ≠ close → inserts pair with cursor between
 * - No selection, char after cursor = close → skips over (no duplicate)
 * - Selection → wraps selection with the pair (e.g. "hello" → "**hello**")
 */
export function buildMarkdownPairKeymap(): Extension {
  const bindings = MARKDOWN_PAIRS.flatMap(([open, close]) => [
    {
      key: open,
      run: (view: EditorView): boolean => {
        const sel = view.state.selection.main;
        const hasSelection = sel.from !== sel.to;

        if (hasSelection) {
          const text = view.state.sliceDoc(sel.from, sel.to);
          view.dispatch({
            changes: [
              { from: sel.from, to: sel.from, insert: open },
              { from: sel.to, to: sel.to, insert: close },
            ],
            selection: {
              anchor: sel.from + open.length + text.length + close.length,
            },
          });
        } else {
          // Skip-over: if the next character is already the closing char,
          // just move the cursor past it instead of inserting a duplicate.
          const nextChar = view.state.sliceDoc(sel.from, sel.from + close.length);
          if (nextChar === close) {
            view.dispatch({
              selection: { anchor: sel.from + close.length },
            });
          } else {
            view.dispatch({
              changes: { from: sel.from, insert: open + close },
              selection: { anchor: sel.from + open.length },
            });
          }
        }
        return true;
      },
    },
  ]);

  return keymap.of(bindings);
}

/** Ordered list pattern: "1. ", "42. ", etc. */
const ORDERED_LIST_RE = /^(\s*)(\d+)\.\s/;
/** Unordered list pattern: "- ", "* ", "+ " */
const UNORDERED_LIST_RE = /^(\s*)[-*+]\s/;
/** Blockquote pattern: "> " */
const BLOCKQUOTE_RE = /^(\s*)>\s/;

/**
 * Auto-continue lists and blockquotes on Enter.
 * - "- item" + Enter → "- " on next line
 * - "1. item" + Enter → "2. " on next line
 * - "> quote" + Enter → "> " on next line
 * - "- " (empty list item) + Enter → removes the bullet
 */
export function buildAutoContinueKeymap(): Extension {
  return keymap.of([
    {
      key: "Enter",
      run: (view: EditorView): boolean => {
        const sel = view.state.selection.main;
        if (sel.from !== sel.to) return false; // let default handle selections

        const doc = view.state.doc;
        const line = doc.lineAt(sel.from);
        const lineText = line.text;

        // Check ordered list: "1. item"
        const ol = ORDERED_LIST_RE.exec(lineText);
        if (ol) {
          const indent = ol[1];
          const num = parseInt(ol[2], 10);
          const afterMarker = lineText.slice(ol[0].length);
          if (afterMarker === "") {
            // Empty list item → remove the entire line
            view.dispatch({
              changes: { from: line.from, to: line.to },
              selection: { anchor: line.from },
            });
          } else {
            view.dispatch({
              changes: { from: sel.from, insert: `\n${indent}${num + 1}. ` },
            });
          }
          return true;
        }

        // Check unordered list: "- item", "* item", "+ item"
        const ul = UNORDERED_LIST_RE.exec(lineText);
        if (ul) {
          const afterMarker = lineText.slice(ul[0].length);
          if (afterMarker === "") {
            view.dispatch({
              changes: { from: line.from, to: line.to },
              selection: { anchor: line.from },
            });
          } else {
            // ul[0] is the full match including indent and trailing space
            view.dispatch({
              changes: { from: sel.from, insert: `\n${ul[0]}` },
            });
          }
          return true;
        }

        // Check blockquote: "> quote"
        const bq = BLOCKQUOTE_RE.exec(lineText);
        if (bq) {
          const afterMarker = lineText.slice(bq[0].length);
          if (afterMarker === "") {
            view.dispatch({
              changes: { from: line.from, to: line.to },
              selection: { anchor: line.from },
            });
          } else {
            // bq[0] is the full match including indent and trailing space
            view.dispatch({
              changes: { from: sel.from, insert: `\n${bq[0]}` },
            });
          }
          return true;
        }

        return false; // let default Enter handle it
      },
    },
  ]);
}

/**
 * Smart backspace: when cursor sits inside an empty pair like **|**,
 * backspace deletes both characters at once.
 */
export function buildSmartBackspaceKeymap(): Extension {
  return keymap.of([
    {
      key: "Backspace",
      run: (view: EditorView): boolean => {
        const sel = view.state.selection.main;
        if (sel.from !== sel.to) return false; // let default handle selections

        const pos = sel.from;
        // Look at the two characters surrounding the cursor
        const before = view.state.sliceDoc(pos - 1, pos);
        const after = view.state.sliceDoc(pos, pos + 1);

        for (const [open, close] of MARKDOWN_PAIRS) {
          if (before === open && after === close) {
            view.dispatch({
              changes: { from: pos - open.length, to: pos + close.length },
            });
            return true;
          }
        }
        return false; // let default backspace handle it
      },
    },
  ]);
}
