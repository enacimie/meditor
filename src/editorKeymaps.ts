import { keymap, EditorView } from "@codemirror/view";
import type { ChangeSpec, EditorState, Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { DocKind } from "./types";

/** Markdown tokens that auto-close in pairs: *, _, ~, `, $ */
export const MARKDOWN_PAIRS: [string, string][] = [
  ["`", "`"],
  ["*", "*"],
  ["_", "_"],
  ["~", "~"],
  ["$", "$"],
];

/*
 * The pairs each language actually has.
 *
 * Markdown's full set; Typst drops the tilde, where `~` is a hard space
 * rather than something to wrap text in; LaTeX keeps only the math
 * delimiter, because its underscore subscripts, its backtick opens a quote
 * and its asterisk marks a starred command — none of them has a partner to
 * close. Smart backspace stays on the full Markdown set: deleting both
 * halves of an empty pair is right wherever the pair came from.
 */
const PAIRS: Record<DocKind, [string, string][]> = {
  markdown: MARKDOWN_PAIRS,
  typst: [
    ["`", "`"],
    ["*", "*"],
    ["_", "_"],
    ["$", "$"],
  ],
  latex: [["$", "$"]],
};

/*
 * Where a pair must not auto-close: inside code or math, in any of the
 * grammars in play. The names are the grammars' own — @lezer/markdown says
 * FencedCode/CodeBlock/InlineCode (with CodeText inside), the Typst grammar
 * says CodeBlock, Code and Math — and a walk up the tree covers the content
 * of a block as well as its fences. LaTeX runs through a StreamLanguage,
 * which builds no such tree; its single pair stays context-free there.
 */
const CODE_NODES = new Set([
  "CodeBlock",
  "FencedCode",
  "InlineCode",
  "CodeText",
  "Code",
  "Math",
]);

function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (;;) {
    if (CODE_NODES.has(node.type.name)) return true;
    const parent = node.parent;
    if (!parent) return false;
    node = parent;
  }
}

/**
 * Build a CodeMirror keymap that auto-closes the formatting pairs of
 * `kind`.
 * - No selection, char after cursor ≠ close → inserts pair with cursor between
 * - No selection, char after cursor = close → skips over (no duplicate)
 * - Selection → wraps it and stays selected, as the Ctrl+B/I toggles do
 * - Inside code or math → declines, and the character inserts itself:
 *   `snake_case` in a fence is an identifier, not emphasised snake
 *
 * Every cursor of a multi-selection is served, through `changeByRange`;
 * the context question is asked of the main one, which is the trade for
 * not leaving a mixed-context multi-cursor with a cursor that receives
 * nothing at all.
 */
export function buildMarkdownPairKeymap(kind: DocKind = "markdown"): Extension {
  const pairs = PAIRS[kind] ?? [];
  if (!pairs.length) return [];
  const bindings = pairs.map(([open, close]) => ({
    key: open,
    run: (view: EditorView): boolean => {
      const { state } = view;
      if (insideCode(state, state.selection.main.head)) return false;
      view.dispatch(
        state.changeByRange((range) => {
          if (range.empty) {
            // Skip-over: if the next character is already the closing char,
            // just move the cursor past it instead of inserting a duplicate.
            const nextChar = state.sliceDoc(range.from, range.from + close.length);
            if (nextChar === close) {
              return { range: EditorSelection.cursor(range.from + close.length) };
            }
            return {
              changes: { from: range.from, insert: open + close },
              range: EditorSelection.cursor(range.from + open.length),
            };
          }
          return {
            changes: [
              { from: range.from, insert: open },
              { from: range.to, insert: close },
            ],
            range: EditorSelection.range(range.from + open.length, range.to + open.length),
          };
        }),
      );
      return true;
    },
  }));

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
 * is going into. LaTeX has no one-character equivalent — `\textbf{}` is a
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

/*
 * A link, from the keyboard: Ctrl+K, as in Word, Google Docs, Typora and
 * Obsidian. It used to focus the find field, which Ctrl+F now reaches from
 * anywhere in the window.
 *
 * The selection becomes the link's text, or its address when it is one, and
 * the caret lands in the slot still empty. With nothing selected it lands in
 * the first slot the syntax has: the text of a Markdown link, the address of
 * a Typst one.
 */
type LinkBuilder = (text: string, url: string) => { insert: string; caret: number };

const LINKS: Partial<Record<DocKind, LinkBuilder>> = {
  // [text](url) — the address starts after "](".
  markdown: (text, url) => ({
    insert: `[${text}](${url})`,
    caret: text && !url ? text.length + 3 : 1,
  }),
  // #link("url")[text] — the address starts after '#link("', the text after '")['.
  typst: (text, url) => ({
    insert: `#link("${url}")[${text}]`,
    caret: url && !text ? url.length + 10 : 7,
  }),
};

/** A selection that is an address rather than words. */
const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.)\S+$/i;

function insertLink(view: EditorView, build: LinkBuilder): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to);
      const url = ADDRESS.test(selected) ? selected : "";
      const { insert, caret } = build(url ? "" : selected, url);
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + caret),
      };
    }),
  );
  return true;
}

/**
 * Bold, italic and links for the document's own language.
 *
 * Empty for a language with no obvious equivalents, so the keys fall through
 * to whatever else wants them rather than doing something almost right.
 * `Mod-Shift-k` stays CodeMirror's delete-line, and on macOS Ctrl+K stays its
 * Emacs-style "delete to the end of the line": the link is Cmd+K there.
 */
export function buildFormattingKeymap(kind: DocKind): Extension {
  const markers = MARKERS[kind];
  const link = LINKS[kind];
  if (!markers || !link) return [];

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
    {
      key: "Mod-k",
      run: (view: EditorView) => insertLink(view, link),
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
