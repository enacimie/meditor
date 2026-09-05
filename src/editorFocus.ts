import { EditorView, Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { Extension, Range } from "@codemirror/state";

/**
 * Two ways of getting out of a writer's way.
 *
 * **Focus mode** dims everything except the paragraph being written, so the
 * eye has one place to be. **Typewriter mode** keeps that line in the middle
 * of the pane instead of letting it walk down to the bottom edge, the way a
 * typewriter moves the paper rather than the type bar.
 *
 * Both are old ideas — iA Writer, ghostwriter, Typora — and both are off
 * unless asked for. They are also independent: some people want the dimming
 * and find the scrolling seasick, and the other way round.
 */

/** Paragraph, because a sentence is a guess and a line is an accident. */
const dimmed = Decoration.line({ class: "cm-dimmed-paragraph" });

/**
 * The lines of the paragraph the cursor is in.
 *
 * A paragraph here is what it is in Markdown — a run of non-blank lines — so
 * a list is dimmed item by item and a wrapped sentence stays whole. Ranges
 * outside the viewport are not asked about: the plugin only ever decorates
 * what is on screen.
 */
function activeParagraph(view: EditorView): { from: number; to: number } {
  const { doc } = view.state;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head);

  let first = line.number;
  while (first > 1 && doc.line(first - 1).text.trim() !== "") first--;
  let last = line.number;
  while (last < doc.lines && doc.line(last + 1).text.trim() !== "") last++;

  return { from: doc.line(first).from, to: doc.line(last).to };
}

/** Dim every visible line outside the paragraph holding the cursor. */
function buildDecorations(view: EditorView): DecorationSet {
  const active = activeParagraph(view);
  const lines: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.to < active.from || line.from > active.to) {
        lines.push(dimmed.range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(lines);
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Selection as well as document: moving the caret to another paragraph
      // is exactly when the dimming has to move with it.
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Keep the line being written in the middle of the pane.
 *
 * The padding is what makes it possible at all: without room above the first
 * line and below the last, neither can reach the middle, and the view simply
 * refuses to scroll there.
 */
const typewriterScroll = EditorView.updateListener.of((update) => {
  if (!update.docChanged && !update.selectionSet) return;
  // Only for the caret's own movements. Left out, a click near the bottom
  // yanks the page around under the reader's hand.
  if (!update.view.hasFocus) return;
  update.view.dispatch({
    effects: EditorView.scrollIntoView(update.state.selection.main.head, {
      y: "center",
    }),
  });
});

const typewriterPadding = EditorView.theme({
  ".cm-content": { paddingBlock: "40vh" },
});

/** Which of the two aids are on. */
export type WritingAids = {
  focusMode: boolean;
  typewriterMode: boolean;
};

/** The extensions for a given pair of settings; empty when both are off. */
export function writingAidExtensions({
  focusMode,
  typewriterMode,
}: WritingAids): Extension {
  const extensions: Extension[] = [];
  if (focusMode) extensions.push(focusPlugin);
  if (typewriterMode) extensions.push(typewriterScroll, typewriterPadding);
  return extensions;
}
