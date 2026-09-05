// @vitest-environment jsdom
/**
 * Focus mode, measured on the real editor.
 *
 * The dimming is a set of decorations a view plugin produces from the cursor
 * position, so there is nothing to check in isolation: what matters is which
 * lines end up carrying the class once CodeMirror has laid the document out.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
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

const DOCUMENT = ["First paragraph.", "", "Second one,", "over two lines.", "", "Third."].join("\n");

function editorElement(options: { focusMode?: boolean; typewriterMode?: boolean }) {
  return (
    <Editor
      activeId="doc-a"
      ids={["doc-a"]}
      content={DOCUMENT}
      onChange={vi.fn()}
      wrap={false}
      kind="markdown"
      focusMode={options.focusMode ?? false}
      typewriterMode={options.typewriterMode ?? false}
    />
  );
}

async function mount(options: { focusMode?: boolean; typewriterMode?: boolean } = {}) {
  const { rerender } = render(editorElement(options));
  await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  );
  if (!view) throw new Error("no EditorView mounted");
  /** Change the settings on the editor that is already running. */
  const setAids = (next: { focusMode?: boolean; typewriterMode?: boolean }) =>
    rerender(editorElement(next));
  return { view, setAids };
}

/** The text of every line currently dimmed, in document order. */
function dimmedLines(): string[] {
  return [...document.querySelectorAll(".cm-dimmed-paragraph")].map(
    (el) => el.textContent ?? "",
  );
}

describe("focus mode", () => {
  it("dims nothing when it is off", async () => {
    await mount();
    expect(dimmedLines()).toEqual([]);
  });

  it("dims every paragraph but the one the cursor is in", async () => {
    const { view } = await mount({ focusMode: true });
    // Into "Second one," — the second paragraph, which runs over two lines.
    const target = view.state.doc.line(3).from + 2;
    view.dispatch({ selection: { anchor: target } });

    await waitFor(() => expect(dimmedLines().length).toBeGreaterThan(0));
    const dimmed = dimmedLines();
    expect(dimmed).toContain("First paragraph.");
    expect(dimmed).toContain("Third.");
    // Both lines of the active paragraph stay lit: a paragraph is the unit,
    // not a line, or a wrapped sentence would go half-dark.
    expect(dimmed).not.toContain("Second one,");
    expect(dimmed).not.toContain("over two lines.");
  });

  it("follows the cursor to another paragraph", async () => {
    const { view } = await mount({ focusMode: true });
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    await waitFor(() => expect(dimmedLines()).toContain("Third."));
    expect(dimmedLines()).not.toContain("First paragraph.");

    view.dispatch({ selection: { anchor: view.state.doc.line(6).from } });
    await waitFor(() => expect(dimmedLines()).toContain("First paragraph."));
    expect(dimmedLines()).not.toContain("Third.");
  });

  it("stops dimming the moment the preference is turned off", async () => {
    /*
     * On the editor that is already running, not a fresh one. The extension
     * lives in a compartment precisely so the setting can change without a
     * remount, and remounting to check it would test nothing about that.
     */
    const { view, setAids } = await mount({ focusMode: true });
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    await waitFor(() => expect(dimmedLines().length).toBeGreaterThan(0));

    setAids({ focusMode: false });
    await waitFor(() => expect(dimmedLines()).toEqual([]));
  });

  it("starts dimming the moment it is turned on", async () => {
    const { view, setAids } = await mount({ focusMode: false });
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    expect(dimmedLines()).toEqual([]);

    setAids({ focusMode: true });
    await waitFor(() => expect(dimmedLines()).toContain("Third."));
  });
});
