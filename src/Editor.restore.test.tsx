// @vitest-environment jsdom
/**
 * The content prop against the per-tab state cache.
 *
 * The Editor keeps one EditorState per tab and restores it on a switch. The
 * cache can lag behind the prop — the file was reloaded from disk while its
 * tab sat in the background — and then the prop is what the application
 * believes the document says, so the prop has to win. What must not happen
 * on the way there: an echo back through onChange (which would mark the
 * reloaded document dirty), or the loss of the writer's undo history and
 * caret, which a rebuilt state throws away and a replacement in place keeps.
 */
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import Editor from "./Editor";

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

function view(): EditorView {
  const found = EditorView.findFromDOM(
    document.querySelector(".cm-editor") as HTMLElement,
  );
  if (!found) throw new Error("no EditorView mounted");
  return found;
}

const IDS = ["doc-a", "doc-b"];

function editorProps(activeId: string, content: string, onChange: () => void) {
  return {
    activeId,
    ids: IDS,
    content,
    onChange,
    wrap: true,
    kind: "markdown" as const,
  };
}

describe("the restored state against the content prop", () => {
  it("shows a background tab's reloaded content when the writer returns to it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor {...editorProps("doc-a", "aaa", onChange)} />,
    );
    rerender(<Editor {...editorProps("doc-b", "bbb", onChange)} />);
    rerender(<Editor {...editorProps("doc-a", "aaa", onChange)} />);
    // While doc-a was active, the application reloaded doc-b from disk.
    rerender(<Editor {...editorProps("doc-b", "BBB from disk", onChange)} />);

    expect(view().state.doc.toString()).toBe("BBB from disk");
    expect(
      onChange,
      "a reload handed down as a prop is not a keystroke and must not be echoed",
    ).not.toHaveBeenCalled();
  });

  it("replaces the active tab's text in place, keeping the undo history", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor {...editorProps("doc-a", "old text", onChange)} />,
    );

    rerender(<Editor {...editorProps("doc-a", "new text from disk", onChange)} />);

    expect(view().state.doc.toString()).toBe("new text from disk");
    expect(onChange).not.toHaveBeenCalled();

    // The replacement is one undoable step, not a rebuilt state: the writer
    // can still reach what they had before the file moved.
    act(() => {
      undo(view());
    });
    expect(view().state.doc.toString()).toBe("old text");
  });

  it("keeps the caret, clamped into the replacement", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor {...editorProps("doc-a", "a quite long line of text", onChange)} />,
    );
    act(() => {
      view().dispatch({ selection: { anchor: view().state.doc.length } });
    });

    rerender(<Editor {...editorProps("doc-a", "short", onChange)} />);

    const { anchor } = view().state.selection.main;
    expect(anchor).toBeLessThanOrEqual("short".length);
    expect(view().state.doc.toString()).toBe("short");
  });

  it("still hands real keystrokes back through onChange", () => {
    // The positive control: the suppress flag around a replacement must not
    // silence the writer.
    const onChange = vi.fn();
    render(<Editor {...editorProps("doc-a", "start", onChange)} />);
    act(() => {
      view().dispatch({
        changes: { from: view().state.doc.length, insert: " typed" },
      });
    });
    expect(onChange).toHaveBeenCalledWith("start typed");
  });
});
