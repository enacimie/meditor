// @vitest-environment jsdom
/**
 * What the editor actually does when a key is pressed.
 *
 * The keymap builders had unit tests all along, and they passed while two of
 * the three aids never ran: those tests called each binding directly, and a
 * binding that CodeMirror never reaches answers exactly the same when asked
 * face to face. `basicSetup` is listed first and binds Backspace and Enter at
 * default precedence, so anything after it at the same precedence is dead.
 *
 * So this file renders the real component — the extension list under test is
 * *the* list, compartments, language loading and all — and dispatches genuine
 * keydown events on the content DOM. Anything about which handler wins belongs
 * here; the commands themselves stay in editorKeymaps.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import Editor from "./Editor";
import { MARKDOWN_PAIRS } from "./editorKeymaps";
import type { DocKind } from "./types";

beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects =
      function () {
        return [] as unknown as DOMRectList;
      };
  }
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Render the editor as App does and hand back its live view. */
async function mount(content: string, kind: DocKind = "markdown") {
  render(
    <Editor
      activeId="doc-a"
      ids={["doc-a"]}
      content={content}
      onChange={vi.fn()}
      wrap={false}
      kind={kind}
    />,
  );
  await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  );
  if (!view) throw new Error("no EditorView mounted");
  return view;
}

/** Put the cursor somewhere, or select a range. */
function setCursor(view: EditorView, pos: number, head?: number) {
  view.dispatch({ selection: { anchor: pos, head: head ?? pos } });
}

/** A real keystroke, through CodeMirror's own keydown handling. */
function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

function text(view: EditorView): string {
  return view.state.doc.toString();
}

describe("backspace", () => {
  it("deletes both halves of an empty pair", async () => {
    // The defect this file exists for: before the fix `deleteCharBackward`
    // from basicSetup answered first and left the opening character behind.
    for (const [open] of MARKDOWN_PAIRS) {
      const view = await mount(open + open);
      setCursor(view, 1);
      press(view, "Backspace");
      expect(
        text(view),
        `backspace inside ${open}|${open} should delete both`,
      ).toBe("");
      cleanup();
    }
  });

  it("deletes both halves of an empty pair in a Typst document", async () => {
    // `$|$` and `*|*` are equation and strong delimiters there too, and the
    // markdown language — which supplies its own Backspace command — is not
    // loaded, so only our own binding can be answering.
    const view = await mount("$$", "typst");
    setCursor(view, 1);
    press(view, "Backspace");
    expect(text(view)).toBe("");
  });

  it("still lets closeBrackets remove a bracket pair", async () => {
    const view = await mount("()");
    setCursor(view, 1);
    press(view, "Backspace");
    expect(text(view)).toBe("");
  });

  it("still deletes one character of ordinary text", async () => {
    const view = await mount("abc");
    setCursor(view, 2);
    press(view, "Backspace");
    expect(text(view)).toBe("ac");
  });

  it("leaves a pair that is not empty to the default", async () => {
    const view = await mount("*text*");
    setCursor(view, 1);
    press(view, "Backspace");
    expect(text(view)).toBe("text*");
  });

  it("still lets the markdown language remove a list marker", async () => {
    const view = await mount("- item\n- ");
    setCursor(view, 9);
    press(view, "Backspace");
    // deleteMarkupBackward strips the marker and leaves the indentation.
    expect(text(view)).toBe("- item\n  ");
  });
});

describe("enter", () => {
  it("continues an unordered list", async () => {
    const view = await mount("- item");
    setCursor(view, 6);
    press(view, "Enter");
    expect(text(view)).toBe("- item\n- ");
  });

  it("continues an ordered list and renumbers what follows", async () => {
    const view = await mount("1. a\n2. b");
    setCursor(view, 4);
    press(view, "Enter");
    expect(text(view)).toBe("1. a\n2. \n3. b");
  });

  it("continues a blockquote", async () => {
    const view = await mount("> quote");
    setCursor(view, 7);
    press(view, "Enter");
    expect(text(view)).toBe("> quote\n> ");
  });

  it("does not continue a list inside a fenced code block", async () => {
    // The regex keymap this replaces could not see the fence and would have
    // written a bullet into the code.
    const view = await mount("```\n- item\n```");
    setCursor(view, 10);
    press(view, "Enter");
    expect(text(view)).toBe("```\n- item\n\n```");
  });
});

describe("markdown pairs", () => {
  it("wraps the selection", async () => {
    const view = await mount("hello");
    setCursor(view, 0, 5);
    press(view, "*");
    expect(text(view)).toBe("*hello*");
  });
});
