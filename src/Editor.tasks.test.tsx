// @vitest-environment jsdom
/**
 * Ticking a task off through the editor's imperative handle.
 *
 * The preview owns the checkboxes and the editor owns the text, so the click
 * arrives here as a line number. What matters is not only that the character
 * changes but how: as one small edit to the live document, so the undo history
 * and the cursor are still there afterwards. `taskList.test.ts` covers where
 * the box is; this covers what the editor does with that.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { EditorView } from "@codemirror/view";
import Editor, { type EditorHandle } from "./Editor";

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

const DOC = ["# Tasks", "", "- [ ] first", "- [x] second", "plain prose"].join("\n");

/** Render the editor as App does and hand back its handle and live view. */
async function mount(content = DOC) {
  const ref = createRef<EditorHandle>();
  const onChange = vi.fn();
  render(
    <Editor
      ref={ref}
      activeId="doc-a"
      ids={["doc-a"]}
      content={content}
      onChange={onChange}
      wrap={false}
      kind="markdown"
    />,
  );
  await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  );
  if (!view || !ref.current) throw new Error("no editor mounted");
  return { handle: ref.current, view, onChange };
}

describe("toggling a task from the preview", () => {
  it("ticks the line it is given and leaves the rest alone", async () => {
    const { handle, view } = await mount();
    handle.toggleTask(2);
    expect(view.state.doc.toString()).toBe(
      ["# Tasks", "", "- [x] first", "- [x] second", "plain prose"].join("\n"),
    );
  });

  it("unticks a finished one", async () => {
    const { handle, view } = await mount();
    handle.toggleTask(3);
    expect(view.state.doc.line(4).text).toBe("- [ ] second");
  });

  it("tells the application the document changed", async () => {
    const { handle, onChange } = await mount();
    handle.toggleTask(2);
    expect(onChange).toHaveBeenCalledWith(
      ["# Tasks", "", "- [x] first", "- [x] second", "plain prose"].join("\n"),
    );
  });

  it("keeps the cursor where the reader left it", async () => {
    const { handle, view } = await mount();
    // Somewhere below the line being ticked, so a reset to the top would show.
    const anchor = view.state.doc.line(5).from + 3;
    view.dispatch({ selection: { anchor } });
    handle.toggleTask(2);
    expect(view.state.selection.main.head).toBe(anchor);
  });

  it("costs exactly one undo step", async () => {
    const { handle, view } = await mount();
    // An edit of the reader's own first, so there is history to lose.
    view.dispatch({ changes: { from: view.state.doc.length, insert: " typed" } });
    handle.toggleTask(2);
    handle.undo();
    expect(view.state.doc.line(3).text).toBe("- [ ] first");
    expect(view.state.doc.toString()).toContain("plain prose typed");
    handle.undo();
    expect(view.state.doc.toString()).not.toContain(" typed");
  });

  it("does nothing to a line that holds no task", async () => {
    const { handle, view, onChange } = await mount();
    handle.toggleTask(4);
    expect(view.state.doc.toString()).toBe(DOC);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("survives a line number the document no longer has", async () => {
    // The preview can be a keystroke behind, and `doc.line` throws rather
    // than shrugging, so an out-of-range number must be turned away here.
    const { handle, view } = await mount();
    expect(() => handle.toggleTask(99)).not.toThrow();
    expect(() => handle.toggleTask(-1)).not.toThrow();
    expect(view.state.doc.toString()).toBe(DOC);
  });
});
