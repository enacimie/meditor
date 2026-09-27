// @vitest-environment jsdom
/**
 * The keymap builders on their own — the commands, not the editor.
 *
 * These call each binding directly, so they say what a command does when it is
 * reached and nothing about whether the editor ever reaches it. Precedence is
 * pinned in Editor.keys.test.tsx instead, through real keydown events on the
 * component: a handler shadowed by basicSetup passes every test in this file.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { EditorView } from "codemirror";
import { EditorState, EditorSelection } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  buildMarkdownPairKeymap,
  buildSmartBackspaceKeymap,
  MARKDOWN_PAIRS,
} from "./editorKeymaps";
import type { DocKind } from "./types";

// Polyfill getClientRects for jsdom — CodeMirror needs it during rAF layout.
beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
});

/** A view holding just the keymaps under test — no basicSetup, no language. */
function makeView(doc: string, kind: DocKind = "markdown") {
  const div = document.createElement("div");
  const state = EditorState.create({
    doc,
    extensions: [
      // basicSetup turns this on in the real editor; without it a dispatch
      // collapses a multi-selection to its main range before the keymap sees
      // it, and the multi-cursor test would test nothing.
      EditorState.allowMultipleSelections.of(true),
      buildMarkdownPairKeymap(kind),
      buildSmartBackspaceKeymap(),
    ],
  });
  return new EditorView({ state, parent: div });
}

function text(view: EditorView): string {
  return view.state.doc.toString();
}

function setCursor(view: EditorView, pos: number, selEnd?: number) {
  view.dispatch({
    selection: { anchor: pos, head: selEnd ?? pos },
  });
}

/**
 * Invoke the binding for `key` directly.
 *
 * Deliberately not a keystroke: this bypasses precedence so each command can
 * be exercised in isolation. Anything that depends on which handler wins
 * belongs in Editor.keys.test.tsx.
 */
function press(view: EditorView, key: string): boolean | undefined {
  for (const facet of view.state.facet(keymap)) {
    for (const binding of facet) {
      if (binding.key === key) {
        const result = binding.run!(view);
        if (result) return true;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Markdown pair keymap
// ---------------------------------------------------------------------------
describe("buildMarkdownPairKeymap", () => {
  it("inserts pair with cursor between for *", () => {
    const v = makeView("");
    press(v, "*");
    expect(text(v)).toBe("**");
    expect(v.state.selection.main.head).toBe(1);
  });

  it("inserts a pair for every configured token", () => {
    for (const [open, close] of MARKDOWN_PAIRS) {
      const v = makeView("");
      press(v, open);
      expect(text(v)).toBe(open + close);
      expect(v.state.selection.main.head).toBe(open.length);
    }
  });

  it("wraps a selection instead of replacing it, and keeps it selected", () => {
    const v = makeView("hello");
    setCursor(v, 0, 5);
    press(v, "*");
    expect(text(v)).toBe("*hello*");
    // Kept selected, as the Ctrl+B/I toggles keep theirs: the writer can
    // carry on with the words they just wrapped.
    const { from, to } = v.state.selection.main;
    expect(v.state.sliceDoc(from, to)).toBe("hello");
  });

  it("skips over the closing char instead of doubling it", () => {
    const v = makeView("``");
    setCursor(v, 1);
    press(v, "`");
    expect(text(v)).toBe("``");
    expect(v.state.selection.main.head).toBe(2);
  });

  it("serves every cursor of a multi-selection", () => {
    const v = makeView("one two");
    v.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
    });
    press(v, "*");
    expect(text(v)).toBe("*one* *two*");
  });
});

describe("the pairs each language has", () => {
  it("gives Typst no tilde pair, where a tilde is a hard space", () => {
    const v = makeView("a", "typst");
    setCursor(v, 1);
    expect(press(v, "~")).toBeUndefined();
    expect(text(v)).toBe("a");
    // The pairs Typst does have still pair.
    expect(press(v, "_")).toBe(true);
    expect(text(v)).toBe("a__");
  });

  it("gives LaTeX only the math pair", () => {
    const v = makeView("a", "latex");
    setCursor(v, 1);
    // Its underscore subscripts and its backtick opens a quote.
    expect(press(v, "_")).toBeUndefined();
    expect(press(v, "`")).toBeUndefined();
    expect(text(v)).toBe("a");
    expect(press(v, "$")).toBe(true);
    expect(text(v)).toBe("a$$");
  });
});

// ---------------------------------------------------------------------------
// Smart backspace keymap
// ---------------------------------------------------------------------------
describe("buildSmartBackspaceKeymap", () => {
  it("deletes empty pair when cursor between", () => {
    for (const [open] of MARKDOWN_PAIRS) {
      const pair = open + open;
      const v = makeView(pair);
      setCursor(v, 1);
      press(v, "Backspace");
      expect(text(v)).toBe("");
    }
  });

  it("declines when the pair is not empty", () => {
    // *text* with cursor at pos 1: before=*, after=t → not an empty pair.
    const v = makeView("*text*");
    setCursor(v, 1);
    expect(press(v, "Backspace")).toBeUndefined();
    expect(text(v)).toBe("*text*");
  });

  it("declines in ordinary text", () => {
    const v = makeView("aa");
    setCursor(v, 1);
    expect(press(v, "Backspace")).toBeUndefined();
    expect(text(v)).toBe("aa");
  });

  it("declines when there is a selection", () => {
    const v = makeView("**");
    setCursor(v, 0, 2);
    expect(press(v, "Backspace")).toBeUndefined();
    expect(text(v)).toBe("**");
  });
});
