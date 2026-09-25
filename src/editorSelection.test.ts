/**
 * Which source lines a selection in the editor covers, for the preview to
 * mark the blocks they draw.
 */
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { selectionLines } from "./editorSelection";

const DOC = ["zero", "one", "two", "three"].join("\n");

/** The document with the main selection from `anchor` to `head`. */
function selected(anchor: number, head: number) {
  return EditorState.create({ doc: DOC, selection: EditorSelection.single(anchor, head) });
}

/** Where a line starts: "zero\n" is five characters. */
const lineStart = (line: number) => DOC.split("\n").slice(0, line).join("\n").length + (line ? 1 : 0);

describe("the lines a selection covers", () => {
  it("are none for a bare caret", () => {
    expect(selectionLines(selected(6, 6))).toBeNull();
  });

  it("are the one line a selection within it is on", () => {
    expect(selectionLines(selected(lineStart(1) + 1, lineStart(1) + 3))).toEqual({ from: 1, to: 1 });
  });

  it("run from the first line to the last, whichever way it was dragged", () => {
    const forwards = selectionLines(selected(lineStart(1) + 2, lineStart(3) + 1));
    const backwards = selectionLines(selected(lineStart(3) + 1, lineStart(1) + 2));
    expect(forwards).toEqual({ from: 1, to: 3 });
    expect(backwards).toEqual({ from: 1, to: 3 });
  });

  it("stop before a line the selection only reaches the start of", () => {
    // Dragging over lines one and two leaves the head at the start of three.
    expect(selectionLines(selected(lineStart(1), lineStart(3)))).toEqual({ from: 1, to: 2 });
  });

  it("keep a line that is all the selection has", () => {
    // From the end of line zero to the start of line one: a line break, and
    // nothing else, is on line zero.
    expect(selectionLines(selected(lineStart(1) - 1, lineStart(1)))).toEqual({ from: 0, to: 0 });
  });
});
