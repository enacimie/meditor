// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  buildMarkdownPairKeymap,
  buildSmartBackspaceKeymap,
  buildAutoContinueKeymap,
  MARKDOWN_PAIRS,
} from "./editorKeymaps";

// Polyfill getClientRects for jsdom — CodeMirror needs it during rAF layout.
beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
});

/** Create a minimal EditorView with just the given keymap extensions (no basicSetup). */
function makeView(doc: string, extensions = [buildMarkdownPairKeymap(), buildSmartBackspaceKeymap(), buildAutoContinueKeymap()]) {
  const div = document.createElement("div");
  const state = EditorState.create({ doc, extensions });
  return new EditorView({ state, parent: div });
}

/** Create a view that has basicSetup + our keymaps (for default Enter/Backspace). */
function makeViewWithDefaults(doc: string) {
  return makeView(doc, [basicSetup, buildMarkdownPairKeymap(), buildSmartBackspaceKeymap(), buildAutoContinueKeymap()]);
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
 * Find a key binding from the view's keymap and invoke it directly.
 * Returns the result of handler.run(view), or undefined if not found.
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

  it("inserts pair for each token", () => {
    for (const [open, _close] of MARKDOWN_PAIRS) {
      const v = makeView("");
      press(v, open);
      expect(text(v)).toBe(open + open);
      expect(v.state.selection.main.head).toBe(1);
    }
  });

  it("wraps selection with single pair", () => {
    const v = makeView("hello");
    setCursor(v, 0, 5);
    press(v, "*");
    expect(text(v)).toBe("*hello*");
    expect(v.state.selection.main.head).toBe(7);
  });

  it("skips over existing closing char", () => {
    const v = makeView("**");
    setCursor(v, 1);
    press(v, "*");
    expect(text(v)).toBe("**");
    expect(v.state.selection.main.head).toBe(2);
  });

  it("skips over closing backtick", () => {
    const v = makeView("``");
    setCursor(v, 1);
    press(v, "`");
    expect(text(v)).toBe("``");
    expect(v.state.selection.main.head).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Smart backspace keymap
// ---------------------------------------------------------------------------
describe("buildSmartBackspaceKeymap", () => {
  it("deletes empty pair when cursor between", () => {
    for (const [open, _close] of MARKDOWN_PAIRS) {
      const pair = open + open;
      const v = makeView(pair);
      setCursor(v, 1);
      press(v, "Backspace");
      expect(text(v)).toBe("");
    }
  });

  it("falls through to default backspace for non-empty pair", () => {
    // *text* with cursor at pos 1: before=*, after=t → not an empty pair
    const v = makeViewWithDefaults("*text*");
    setCursor(v, 1);
    press(v, "Backspace"); // handler returns false, default deletes *
    expect(text(v)).toBe("text*");
  });

  it("falls through to default backspace in normal text", () => {
    const v = makeViewWithDefaults("abc");
    setCursor(v, 2);
    press(v, "Backspace");
    expect(text(v)).toBe("ac");
  });

  it("does not delete non-pair characters with backspace", () => {
    // Cursor between two 'a' chars is not a pair token
    const v = makeView("a|a".replace("|", ""));
    setCursor(v, 1);
    press(v, "Backspace"); // handler returns false
    // Without basicSetup, nothing happens — doc stays same
    expect(text(v)).toBe("aa");
  });
});

// ---------------------------------------------------------------------------
// Auto-continue keymap
// ---------------------------------------------------------------------------
describe("buildAutoContinueKeymap", () => {
  describe("unordered lists", () => {
    it("continues - list on Enter", () => {
      const v = makeView("- item");
      setCursor(v, 6);
      press(v, "Enter");
      expect(text(v)).toBe("- item\n- ");
    });

    it("continues * list on Enter", () => {
      const v = makeView("* item");
      setCursor(v, 6);
      press(v, "Enter");
      expect(text(v)).toBe("* item\n* ");
    });

    it("continues + list on Enter", () => {
      const v = makeView("+ item");
      setCursor(v, 6);
      press(v, "Enter");
      expect(text(v)).toBe("+ item\n+ ");
    });

    it("removes empty list item on Enter", () => {
      const v = makeView("- item\n- ");
      setCursor(v, 9);
      press(v, "Enter");
      expect(text(v)).toBe("- item\n");
    });

    it("preserves indentation on continue", () => {
      const v = makeView("  - item");
      setCursor(v, 8);
      press(v, "Enter");
      expect(text(v)).toBe("  - item\n  - ");
    });
  });

  describe("ordered lists", () => {
    it("continues with incremented number", () => {
      const v = makeView("1. item");
      setCursor(v, 7);
      press(v, "Enter");
      expect(text(v)).toBe("1. item\n2. ");
    });

    it("increments from arbitrary number", () => {
      const v = makeView("42. item");
      setCursor(v, 8);
      press(v, "Enter");
      expect(text(v)).toBe("42. item\n43. ");
    });

    it("removes empty ordered item on Enter", () => {
      const v = makeView("1. item\n2. ");
      setCursor(v, 11);
      press(v, "Enter");
      expect(text(v)).toBe("1. item\n");
    });

    it("preserves indentation on ordered continue", () => {
      const v = makeView("  1. item");
      setCursor(v, 9);
      press(v, "Enter");
      expect(text(v)).toBe("  1. item\n  2. ");
    });
  });

  describe("blockquotes", () => {
    it("continues blockquote on Enter", () => {
      const v = makeView("> quote");
      setCursor(v, 7);
      press(v, "Enter");
      expect(text(v)).toBe("> quote\n> ");
    });

    it("removes empty blockquote on Enter", () => {
      const v = makeView("> quote\n> ");
      setCursor(v, 10);
      press(v, "Enter");
      expect(text(v)).toBe("> quote\n");
    });
  });

  describe("non-list lines", () => {
    it("lets default Enter handle normal text", () => {
      const v = makeViewWithDefaults("hello");
      setCursor(v, 5);
      press(v, "Enter"); // auto-continue returns false
      expect(text(v)).toBe("hello\n");
    });

    it("does not intercept Enter when selection is non-empty", () => {
      const v = makeViewWithDefaults("- item");
      setCursor(v, 0, 2);
      press(v, "Enter");
      expect(text(v)).toBe("\nitem");
    });
  });
});
