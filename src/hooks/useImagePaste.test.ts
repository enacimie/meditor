// @vitest-environment jsdom
/**
 * Pasting an image, while the document keeps moving underneath it.
 *
 * Reading a file is asynchronous. The old code captured the cursor position
 * when the read started and inserted there when the bytes arrived, so any edit
 * in between — including its own placeholder — left the image somewhere else
 * and the placeholder text in the document. These tests drive the read by
 * hand, so the gap between "started" and "finished" is a place where things
 * can be made to happen rather than a race nobody can reach.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { ClipboardEvent, DragEvent } from "react";

const writeImage = vi.fn();
vi.mock("../backend", () => ({
  backend: {
    writeImage: (...args: unknown[]) => writeImage(...args),
  },
}));

const {
  useImagePaste,
  imagePlaceholderField,
}: typeof import("./useImagePaste") = await import("./useImagePaste");
type ImagePasteError = import("./useImagePaste").ImagePasteError;

beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects =
      function () {
        return [] as unknown as DOMRectList;
      };
  }
});

/** Every FileReader the code under test constructs, newest last. */
const readers: FakeFileReader[] = [];

/**
 * A FileReader whose completion the test decides.
 *
 * The real one resolves on its own schedule, which would leave no window in
 * which to type, move the cursor or switch tabs.
 */
class FakeFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  constructor() {
    readers.push(this);
  }
  readAsDataURL(_file: File) {
    /* the test calls resolve() or fail() instead */
  }
  resolve(dataUrl: string) {
    this.result = dataUrl;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

vi.stubGlobal("FileReader", FakeFileReader);

beforeEach(() => {
  writeImage.mockReset();
  writeImage.mockResolvedValue(null);
});

afterEach(() => {
  readers.length = 0;
  vi.restoreAllMocks();
});

/** An editor with the placeholder field and an undo history, as Editor mounts it. */
function makeView(doc: string, cursor: number) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), imagePlaceholderField],
    }),
    parent,
  });
}

/** A file of a given size, without allocating the bytes. */
function makeFile(name: string, size: number, type = "image/png"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const BIG = 2_000_000;
const SMALL = 10;
const TOO_BIG = 11 * 1024 * 1024;

function setup(view: EditorView, docHandle: string | null = null) {
  const errors: ImagePasteError[] = [];
  const { result } = renderHook(() =>
    useImagePaste({
      viewRef: { current: view },
      docHandle,
      locale: "en",
      onError: (error) => errors.push(error),
    }),
  );
  return { api: result, errors };
}

function pasteEvent(file: File) {
  return {
    preventDefault: vi.fn(),
    clipboardData: {
      items: [
        { kind: "file", type: file.type, getAsFile: () => file },
      ] as unknown as DataTransferItemList,
    },
  } as unknown as ClipboardEvent<HTMLDivElement>;
}

function dropEvent(file: File) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { files: [file] } as unknown as DataTransfer,
  } as unknown as DragEvent<HTMLDivElement>;
}

function text(view: EditorView): string {
  return view.state.doc.toString();
}

const DATA_URL = "data:image/png;base64,QUJD";

describe("pasting a large image", () => {
  it("replaces its placeholder even after the document moves", async () => {
    const view = makeView("abc", 3);
    const { api } = setup(view);

    api.current.handlePaste(pasteEvent(makeFile("big.png", BIG)));
    await waitFor(() => expect(readers.length).toBe(1));
    expect(text(view)).toBe("abc![big.png](Reading image…)");

    // The user carries on while the read is in flight: text before the
    // placeholder, and the cursor moved away from it entirely.
    view.dispatch({ changes: { from: 0, insert: "zz" }, selection: { anchor: 0 } });

    readers[0].resolve(DATA_URL);

    await waitFor(() =>
      expect(text(view)).toBe(`zzabc![big.png](${DATA_URL})`),
    );
    expect(text(view)).not.toContain("Reading image");
    expect(view.state.selection.main.head).toBe(
      `zzabc![big.png](${DATA_URL})`.length,
    );
    expect(view.state.field(imagePlaceholderField)).toHaveLength(0);
  });

  it("costs exactly one undo, and never shows the placeholder again", async () => {
    // The reading of a big file takes longer than the history's grouping
    // window, so the placeholder and the image it becomes land in different
    // undo events. Without that gap every transaction here would be joined
    // into one and the test could not tell a clean history from a dirty one —
    // it would pass with the placeholder recorded, which is the whole point.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const view = makeView("ab", 2);
      // An edit of the user's own to undo into, so a step the paste left
      // behind is visible: with nothing beneath it, a dead undo and a real one
      // look the same.
      view.dispatch({ changes: { from: 2, insert: "c" }, selection: { anchor: 3 } });
      const { api } = setup(view);

      api.current.handlePaste(pasteEvent(makeFile("big.png", BIG)));
      await vi.waitFor(() => expect(readers.length).toBe(1));
      expect(text(view)).toContain("Reading image");

      vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
      readers[0].resolve(DATA_URL);
      await vi.waitFor(() => expect(text(view)).toContain(DATA_URL));

      undo(view);
      expect(text(view), "the first undo takes the image out").toBe("abc");
      expect(
        text(view),
        "and does not put the placeholder back in its place",
      ).not.toContain("Reading image");
      undo(view);
      expect(
        text(view),
        "the second undo reaches the user's own edit, not a step the paste left behind",
      ).toBe("ab");
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the placeholder back out when the read fails", async () => {
    const view = makeView("abc", 3);
    const { api, errors } = setup(view);

    api.current.handlePaste(pasteEvent(makeFile("big.png", BIG)));
    await waitFor(() => expect(readers.length).toBe(1));
    expect(text(view)).toContain("Reading image");

    readers[0].fail();

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(text(view)).toBe("abc");
    expect(errors[0]).toEqual({ kind: "failed", name: "big.png" });
    // The busy flag is React state, so it lands on a later render than the
    // error callback; waiting for it is the difference between this test
    // passing always and passing most of the time.
    await waitFor(() => expect(api.current.busy).toBe(false));
  });
});

describe("pasting a small image", () => {
  it("lands where the paste happened, not where the cursor went", async () => {
    const view = makeView("abc", 3);
    const { api } = setup(view);

    api.current.handlePaste(pasteEvent(makeFile("small.png", SMALL)));
    await waitFor(() => expect(readers.length).toBe(1));
    // No placeholder for a small file — only the anchor.
    expect(text(view)).toBe("abc");

    view.dispatch({ selection: { anchor: 0 } });
    readers[0].resolve(DATA_URL);

    await waitFor(() => expect(text(view)).toBe(`abc![small.png](${DATA_URL})`));
  });
});

describe("an image over the limit", () => {
  it("is reported instead of being dropped in silence", async () => {
    const view = makeView("abc", 3);
    const { api, errors } = setup(view);

    api.current.handlePaste(pasteEvent(makeFile("huge.png", TOO_BIG)));

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toEqual({ kind: "tooLarge", name: "huge.png", maxMiB: 10 });
    expect(readers).toHaveLength(0);
    expect(text(view)).toBe("abc");
  });
});

describe("pasting over a selection", () => {
  it("replaces it, and undoes in two steps", async () => {
    const view = makeView("abc", 1);
    view.dispatch({ selection: { anchor: 1, head: 2 } });
    const { api } = setup(view);

    api.current.handlePaste(pasteEvent(makeFile("big.png", BIG)));
    await waitFor(() => expect(readers.length).toBe(1));
    readers[0].resolve(DATA_URL);

    await waitFor(() => expect(text(view)).toBe(`a![big.png](${DATA_URL})c`));

    undo(view); // the image
    undo(view); // the selection it replaced
    expect(text(view)).toBe("abc");
  });
});

describe("dropping a file", () => {
  it("goes through the same path as a paste", async () => {
    const view = makeView("abc", 3);
    const { api } = setup(view);

    void api.current.handleDrop(dropEvent(makeFile("big.png", BIG)));
    await waitFor(() => expect(readers.length).toBe(1));
    readers[0].resolve(DATA_URL);

    await waitFor(() => expect(text(view)).toBe(`abc![big.png](${DATA_URL})`));
    expect(text(view)).not.toContain("Reading image");
  });
});

describe("a document that has been saved", () => {
  /*
   * A `.md` carrying its pictures as base64 is portable and enormous: a couple
   * of screenshots outweigh the prose several times over, in the file, in the
   * session snapshot and in every export. A saved document gets real files
   * beside it and a link.
   */

  it("writes the image beside the document and links to it", async () => {
    writeImage.mockResolvedValue({ relPath: "assets/shot.png" });
    const view = makeView("abc", 3);
    const { api } = setup(view, "doc-1");

    api.current.handlePaste(pasteEvent(makeFile("shot.png", SMALL)));

    await waitFor(() => expect(text(view)).toBe("abc![shot.png](assets/shot.png)"));
    // No base64 anywhere: the bytes went to disk, not into the document.
    expect(text(view)).not.toContain("data:");
    expect(writeImage).toHaveBeenCalledWith(
      "doc-1",
      "shot.png",
      expect.any(Uint8Array),
      "en",
    );
  });

  it("links to the name the backend chose, not the one proposed", async () => {
    // The backend renames on a collision, and the document has to point at
    // the file that now exists rather than the one that was asked for.
    writeImage.mockResolvedValue({ relPath: "assets/shot-1.png" });
    const view = makeView("", 0);
    const { api } = setup(view, "doc-1");

    api.current.handlePaste(pasteEvent(makeFile("shot.png", SMALL)));

    await waitFor(() => expect(text(view)).toBe("![shot-1.png](assets/shot-1.png)"));
  });

  it("escapes a name that would break the link", async () => {
    writeImage.mockResolvedValue({ relPath: "assets/mi foto.png" });
    const view = makeView("", 0);
    const { api } = setup(view, "doc-1");

    api.current.handlePaste(pasteEvent(makeFile("mi foto.png", SMALL)));

    // A bare space ends the link target in Markdown, so the picture would not
    // load and the rest of the line would be read as a title.
    await waitFor(() => expect(text(view)).toContain("(assets/mi%20foto.png)"));
  });

  it("gives a clipboard screenshot a name of its own", async () => {
    // Every browser calls a pasted screenshot `image.png`, so a folder of them
    // would be image.png, image-1.png, image-2.png with nothing to tell them
    // apart.
    writeImage.mockResolvedValue({ relPath: "assets/whatever.png" });
    const view = makeView("", 0);
    const { api } = setup(view, "doc-1");

    api.current.handlePaste(pasteEvent(makeFile("image.png", SMALL)));

    await waitFor(() => expect(writeImage).toHaveBeenCalled());
    const proposed = writeImage.mock.calls[0][1] as string;
    expect(proposed).toMatch(/^image-\d{8}-\d{6}[.]png$/);
  });

  it("keeps a dragged file's own name", async () => {
    writeImage.mockResolvedValue({ relPath: "assets/diagram.png" });
    const view = makeView("", 0);
    const { api } = setup(view, "doc-1");

    void api.current.handleDrop(dropEvent(makeFile("diagram.png", SMALL)));

    await waitFor(() => expect(writeImage).toHaveBeenCalled());
    expect(writeImage.mock.calls[0][1]).toBe("diagram.png");
  });
});

describe("a document with nowhere to write", () => {
  it("embeds the image, without a word", async () => {
    // A new tab, an Android content URI, the web build. Losing the picture or
    // demanding a save first would both be worse than a larger document.
    const view = makeView("abc", 3);
    const { api, errors } = setup(view, null);

    api.current.handlePaste(pasteEvent(makeFile("shot.png", SMALL)));
    await waitFor(() => expect(readers.length).toBe(1));
    readers[0].resolve(DATA_URL);

    await waitFor(() => expect(text(view)).toBe(`abc![shot.png](${DATA_URL})`));
    expect(writeImage).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });

  it("embeds it when the backend says there is nowhere", async () => {
    writeImage.mockResolvedValue(null);
    const view = makeView("", 0);
    const { api, errors } = setup(view, "doc-1");

    api.current.handlePaste(pasteEvent(makeFile("shot.png", SMALL)));
    await waitFor(() => expect(readers.length).toBe(1));
    readers[0].resolve(DATA_URL);

    await waitFor(() => expect(text(view)).toContain(DATA_URL));
    expect(errors).toHaveLength(0);
  });

  it("embeds it and says so when the write fails", async () => {
    // Disk full, permission refused. The paste still happens — losing the
    // image would be worse — but the user is told why the file is not there.
    writeImage.mockRejectedValue(new Error("disk full"));
    const view = makeView("", 0);
    const { api, errors } = setup(view, "doc-1");

    api.current.handlePaste(pasteEvent(makeFile("shot.png", SMALL)));
    await waitFor(() => expect(readers.length).toBe(1));
    readers[0].resolve(DATA_URL);

    await waitFor(() => expect(text(view)).toContain(DATA_URL));
    expect(errors).toEqual([{ kind: "notStored", name: "shot.png" }]);
  });
});
