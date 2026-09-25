// @vitest-environment jsdom
/**
 * What the Editor tells the preview about its selection: the lines it covers,
 * nothing once only a caret is left, and each change once.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EditorView } from "codemirror";
import Editor from "./Editor";

// CodeMirror needs getClientRects during layout — jsdom lacks it.
beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DOC = "zero\none\ntwo\nthree";

function mount(heard: (lines: unknown) => void, activeId = "a") {
  const props = { ids: ["a", "b"], content: DOC, onChange: () => {}, wrap: true, kind: "markdown" as const };
  const utils = render(<Editor activeId={activeId} {...props} onSelectionLinesChange={heard} />);
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  const show = (id: string) =>
    utils.rerender(<Editor activeId={id} {...props} onSelectionLinesChange={heard} />);
  return { view, show };
}

describe("the selection the Editor reports", () => {
  it("is the lines selected, then nothing once only a caret is left", () => {
    const heard = vi.fn();
    const { view } = mount(heard);
    // "one\ntw": from line one into line two.
    view.dispatch({ selection: { anchor: 6, head: 12 } });
    expect(heard).toHaveBeenLastCalledWith({ from: 1, to: 2 });
    view.dispatch({ selection: { anchor: 3 } });
    expect(heard).toHaveBeenLastCalledWith(null);
  });

  it("is told once for each change, not for every step that leaves the lines alone", () => {
    const heard = vi.fn();
    const { view } = mount(heard);
    view.dispatch({ selection: { anchor: 5, head: 7 } });
    view.dispatch({ selection: { anchor: 5, head: 8 } });
    // Typing before the selection moves it, but not off line one.
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({ from: 1, to: 1 });
  });

  it("is the other document's when the tab changes", () => {
    const heard = vi.fn();
    const { view, show } = mount(heard);
    view.dispatch({ selection: { anchor: 6, head: 12 } });
    show("b");
    expect(heard).toHaveBeenLastCalledWith(null);
    show("a");
    expect(heard).toHaveBeenLastCalledWith({ from: 1, to: 2 });
  });
});
