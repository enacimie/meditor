// @vitest-environment jsdom
/**
 * Regression tests for the "dirty-on-mount" bug class:
 * a session-restored (or freshly opened) document must NEVER be reported as
 * changed by the Editor just because the view was created or re-rendered.
 *
 * A dirty doc is produced when `onChange` fires with content that differs from
 * the stored doc content. These tests pin down that the Editor only reports
 * REAL user edits, never mount/sync artifacts.
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
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

describe("Editor mount dirty regression", () => {
  it("does not call onChange on mount for any content shape", () => {
    const cases = [
      "# title\n\nbody text",
      "no trailing newline",
      "",
      "a\n\n", // trailing blank line
      "line1\r\nline2", // CRLF
      "single line\n",
    ];
    for (const content of cases) {
      const onChange = vi.fn();
      render(
        <Editor activeId="a" ids={["a"]} content={content} onChange={onChange} wrap kind="markdown" />,
      );
      expect(onChange).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("does not call onChange under StrictMode double-mount", () => {
    const onChange = vi.fn();
    render(
      <StrictMode>
        <Editor activeId="a" ids={["a"]} content="# heading" onChange={onChange} wrap kind="markdown" />
      </StrictMode>,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when re-rendered with identical content", () => {
    const onChange = vi.fn();
    const ui = (
      <Editor activeId="a" ids={["a"]} content="same content" onChange={onChange} wrap kind="markdown" />
    );
    const { rerender } = render(ui);
    rerender(ui);
    rerender(ui);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when wrap is toggled (reconfigure only)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor activeId="a" ids={["a"]} content="wrap me" onChange={onChange} wrap kind="markdown" />,
    );
    rerender(
      <Editor activeId="a" ids={["a"]} content="wrap me" onChange={onChange} wrap={false} kind="markdown" />,
    );
    rerender(
      <Editor activeId="a" ids={["a"]} content="wrap me" onChange={onChange} wrap kind="markdown" />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("positive control: onChange fires only for real document changes", () => {
    const onChange = vi.fn();
    const div = document.createElement("div");
    const state = EditorState.create({
      doc: "hello",
      extensions: [
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: div });
    expect(onChange).not.toHaveBeenCalled();
    view.dispatch({ changes: { from: 5, insert: " world" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("hello world");
    view.destroy();
  });
});
