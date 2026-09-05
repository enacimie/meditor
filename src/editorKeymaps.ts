import { keymap, EditorView } from "@codemirror/view";
import type { ChangeSpec, Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { DocKind } from "./types";

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

/*
 * Bold and italic, from the keyboard.
 *
 * Every one of these toggles rather than only wrapping. Ctrl+B on text that is
 * already bold is how a writer un-bolds it — in a word processor, in a
 * comment box, everywhere — and a shortcut that only ever added markers would
 * turn `**word**` into `****word****` and look broken.
 *
 * The markers differ by language, so the keymap is built for the document it
 * is going into. LaTeX has no one-character equivalent — `	extbf{}` is a
 * command, not a wrapper — and is left out rather than guessed at.
 */
type FormattingMarkers = {
  bold: string;
  italic: string;
};

const MARKERS: Partial<Record<DocKind, FormattingMarkers>> = {
  markdown: { bold: "**", italic: "*" },
  // Typst writes them with single characters: *bold* and _italic_.
  typst: { bold: "*", italic: "_" },
};

/**
 * Wrap each selection in `marker`, or take it off when it is already there.
 *
 * Two ways a range can already be wrapped, and both have to be recognised or
 * the toggle only works when the selection was made one particular way: the
 * markers can be inside the selection (the user selected `**word**`) or just
 * outside it (they selected `word` between markers).
 */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const length = marker.length;

  view.dispatch(
    state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to);

      // Markers inside the selection.
      if (
        selected.length >= length * 2 &&
        selected.startsWith(marker) &&
        selected.endsWith(marker)
      ) {
        const inner = selected.slice(length, selected.length - length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }

      // Markers just outside it.
      const before = state.sliceDoc(Math.max(0, range.from - length), range.from);
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + length));
      if (before === marker && after === marker) {
        const changes: ChangeSpec[] = [
          { from: range.from - length, to: range.from },
          { from: range.to, to: range.to + length },
        ];
        return {
          changes,
          range: EditorSelection.range(range.from - length, range.to - length),
        };
      }

      // Not wrapped: wrap it. An empty selection becomes an empty pair with
      // the cursor between the markers, ready to type into.
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(
          range.from + length,
          range.to + length,
        ),
      };
    }),
  );
  return true;
}

/**
 * Bold and italic for the document's own language.
 *
 * Empty for a language with no obvious equivalents, so the keys fall through
 * to whatever else wants them rather than doing something almost right.
 *
 * No link shortcut. The two keys a writer would reach for are already taken
 * by things worth keeping — `Mod-k` focuses the find field, and
 * `Mod-Shift-k` is CodeMirror's delete-line — and quietly taking one of them
 * is a bigger decision than adding a shortcut.
 */
export function buildFormattingKeymap(kind: DocKind): Extension {
  const markers = MARKERS[kind];
  if (!markers) return [];

  const bindings = [
    {
      key: "Mod-b",
      run: (view: EditorView) => toggleWrap(view, markers.bold),
      preventDefault: true,
    },
    {
      key: "Mod-i",
      run: (view: EditorView) => toggleWrap(view, markers.italic),
      preventDefault: true,
    },
  ];

  return keymap.of(bindings);
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
