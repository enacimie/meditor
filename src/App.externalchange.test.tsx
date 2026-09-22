// @vitest-environment jsdom
/**
 * External-change watch: the app must notice when an open file is rewritten
 * behind its back, reload clean documents silently, and raise the three-way
 * conflict dialog for dirty ones (reload / keep mine / save as).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";
import { EditorView } from "@codemirror/view";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: { modifiedMs: 1000, size: 10 },
  disk: "v2",
  /** The same, for the file Save As writes. */
  stat2: { modifiedMs: 5000, size: 20 },
  disk2: "",
  dirty: false,
  /** The fingerprint the session carries back for the restored document. */
  sessionStat: null as { modifiedMs: number; size: number } | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: h.invoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: () => Promise.resolve(() => {}) }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("./Preview", () => ({
  default: () => <div data-testid="preview-mock" />,
}));

function sessionDoc() {
  return {
    id: "doc-1",
    name: "notes.md",
    path: "/tmp/notes.md",
    content: h.dirty ? "my edit" : "v1",
    dirty: h.dirty,
    handle: "h-1",
    kind: "markdown",
    // What the session recorded of the file when it was written. `null` is a
    // session from a build that did not keep one.
    stat: h.sessionStat,
  };
}

function resetInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "platform":
        return "linux";
      case "cli_files":
        return [];
      case "load_session":
        return { docs: [sessionDoc()], activeId: "doc-1", split: 50 };
      case "document_stat":
        // The file Save As creates is a different file, with a fingerprint of
        // its own; answering the original's for both would hide the very
        // thing the Save As test is about.
        return args?.handle === "h-2" ? h.stat2 : h.stat;
      case "read_document":
        return args?.handle === "h-2" ? h.disk2 : h.disk;
      case "save_as":
        return {
          id: "doc-new",
          name: "notes.md",
          path: "/tmp/other.md",
          content: args?.content,
          dirty: false,
          handle: "h-2",
          kind: "markdown",
        };
      default:
        return null;
    }
  });
}

// One poll interval. act() around the clock advance makes React commit the
// state updates the fired callbacks produce before assertions run.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function tick() {
  await advance(3100);
}

async function clickDialogButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    // Run out the dialog's exit transition; the parent unmounts it after.
    await vi.advanceTimersByTimeAsync(300);
  });
}

/**
 * Fake timers go in BEFORE the render: the watch interval must be created
 * against the fake clock, or advancing it would never fire the callbacks.
 * The editor loads through a lazy import, so mounting is waited out with
 * bounded clock advances rather than wall-clock waitFor.
 */
async function mountApp() {
  vi.useFakeTimers();
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  for (let i = 0; i < 200 && !document.querySelector(".cm-editor"); i += 1) {
    await advance(50);
  }
  expect(document.querySelector(".cm-editor")).toBeTruthy();
  // First poll adopts the initial fingerprint, settling the baseline.
  await tick();
}

function editorText(): string {
  return document.querySelector(".cm-content")?.textContent ?? "";
}

function conflictDialog(): HTMLElement | null {
  return document.querySelector(".conflict-overlay");
}

beforeAll(async () => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  /*
   * Load the editor before any fake clock exists.
   *
   * App reaches it through `React.lazy`, so mounting starts a dynamic import —
   * and a dynamic import does not complete while the timers are faked, which
   * they are from the first line of `mountApp` onwards. `.cm-editor` then
   * never appears and every test in this file fails on the same assertion,
   * about the editor rather than about anything it was written to check.
   *
   * It passed all the same for as long as the whole suite ran together: Vite
   * caches transforms across the run, so by the time this file executed the
   * module was already prepared and resolved inside the window the fake clock
   * allowed. Run on its own it had to be transformed from cold, and did not.
   *
   * Resolving it here, on real timers, makes the file stand up by itself
   * without changing a single assertion.
   */
  await import("./Editor");
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  h.stat = { modifiedMs: 1000, size: 10 };
  // The disk matches the open buffer until a test simulates an external edit.
  h.disk = "v1";
  h.stat2 = { modifiedMs: 5000, size: 20 };
  h.disk2 = "";
  h.dirty = false;
  h.sessionStat = null;
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a file that changed while meditor was closed", () => {
  /*
   * The report this came from: a document open in meditor, edited by another
   * program, and meditor never showing it — not after three seconds, not
   * after restarting the application, and not after restarting it again. The
   * only way out was closing the tab and opening the file afresh.
   *
   * The session used to reattach a document to its file only when the bytes
   * on disk still matched the snapshot it had saved. Anything else wrote the
   * file and the document came back with its path and no handle: the tab
   * looked attached and was not, and the watch skips a document with no
   * handle, so nothing ever looked at that file again. Restarting repeated
   * the same failed comparison, which is why it never recovered.
   */
  it("reloads it, rather than sitting on the old text for ever", async () => {
    // The file moved on while the app was shut: the session's fingerprint is
    // the old one, the disk has somebody else's bytes.
    h.sessionStat = { modifiedMs: 1000, size: 10 };
    h.stat = { modifiedMs: 7000, size: 24 };
    h.disk = "written by something else";

    await mountApp();

    expect(editorText(), "the buffer should have caught up with the file").toContain(
      "written by something else",
    );
    expect(conflictDialog(), "nothing to ask about: the buffer was clean").toBeNull();
  });

  it("asks, when the writer had unsaved work of their own", async () => {
    // Both changed: the writer left unsaved work and the file moved too. That
    // is the one case worth a question, and the dialog already exists for it.
    h.dirty = true;
    h.sessionStat = { modifiedMs: 1000, size: 10 };
    h.stat = { modifiedMs: 7000, size: 24 };
    h.disk = "written by something else";

    await mountApp();

    expect(conflictDialog(), "two edits, one file — this one has to be asked").toBeTruthy();
    expect(editorText(), "and nothing is thrown away before the answer").toContain("my edit");
  });

  it("writes the fingerprint it is watching into the session", async () => {
    /*
     * The other end of the same wire, and the half a reader would assume.
     *
     * Everything above starts from a session that already carries a
     * fingerprint. If the app stopped putting one there, every launch would
     * behave like a session from an older build — and for a buffer with
     * unsaved work that means being asked about a conflict that is only the
     * writer's own typing.
     */
    h.sessionStat = { modifiedMs: 1000, size: 10 };
    await mountApp();

    // The file moves; the watch adopts it, and that is what should be stored.
    h.stat = { modifiedMs: 4242, size: 17 };
    h.disk = "moved on";
    await tick();
    await advance(1000);

    const saved = h.invoke.mock.calls.filter(([cmd]) => cmd === "save_session");
    expect(saved.length, "the session should have been written").toBeGreaterThan(0);
    // The command takes the session under an `input` key, not at the top.
    const last = saved[saved.length - 1][1] as {
      input: {
        docs: Array<{
          handle: string | null;
          stat: { modifiedMs: number; size: number } | null;
        }>;
      };
    };
    const doc = last.input.docs.find((d) => d.handle === "h-1");
    expect(doc?.stat, "and it should carry the file as the watch last saw it").toEqual({
      modifiedMs: 4242,
      size: 17,
    });
  });

  it("leaves unsaved work alone when the file did not move", async () => {
    /*
     * The other half, and the reason the fingerprint is stored at all.
     *
     * A buffer that differs from its file is the normal way to come back to
     * unsaved work — the session has always restored it. Only the fingerprint
     * says whether the *file* moved as well, and when it has not, there is
     * nothing to report and nothing to ask.
     */
    h.dirty = true;
    h.sessionStat = { modifiedMs: 1000, size: 10 };
    h.stat = { modifiedMs: 1000, size: 10 };
    h.disk = "v1";

    await mountApp();

    expect(conflictDialog(), "the file is untouched; there is nothing to ask").toBeNull();
    expect(editorText(), "and the unsaved work is still there").toContain("my edit");
    expect(
      document.querySelector(".tab.active .tab-dirty"),
      "still unsaved, and still saying so",
    ).toBeTruthy();
  });
});

describe("external file changes", () => {
  it("reloads a clean document silently when the file changes on disk", async () => {
    await mountApp();
    expect(editorText()).toContain("v1");

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "v2";
    await tick();

    expect(editorText()).toContain("v2");
    expect(conflictDialog()).toBeNull();
    expect(document.querySelector(".tab.active .tab-dirty")).toBeNull();
  });

  it("raises the conflict dialog for a dirty document and reloads on demand", async () => {
    h.dirty = true;
    h.disk = "my edit";
    await mountApp();

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "their edit";
    await tick();

    const dialog = conflictDialog();
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("notes.md");

    vi.mocked(h.invoke).mockClear();
    await clickDialogButton("Reload from disk");

    expect(editorText()).toContain("their edit");
    expect(conflictDialog()).toBeNull();
    expect(document.querySelector(".tab.active .tab-dirty")).toBeNull();
    // Reloading must not write to disk.
    expect(h.invoke).not.toHaveBeenCalledWith("save_document", expect.anything());
  });

  it("keeps the buffer on 'keep mine', then routes 'save as…' through the dialog", async () => {
    h.dirty = true;
    h.disk = "my edit";
    await mountApp();

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "their edit";
    await tick();
    expect(conflictDialog()).toBeTruthy();

    await clickDialogButton("Keep mine");
    expect(conflictDialog()).toBeNull();
    expect(editorText()).toContain("my edit");
    expect(document.querySelector(".tab.active .tab-dirty")).toBeTruthy();

    // A second external change re-raises the dialog; this time save the
    // buffer elsewhere instead of picking a side.
    h.stat = { modifiedMs: 3000, size: 15 };
    h.disk = "their edit 2";
    await tick();
    expect(conflictDialog()).toBeTruthy();

    vi.mocked(h.invoke).mockClear();
    await clickDialogButton("Save as…");

    const saveAsCall = h.invoke.mock.calls.find(([cmd]) => cmd === "save_as");
    expect(saveAsCall).toBeDefined();
    expect(saveAsCall?.[1]?.content).toBe("my edit");
    expect(conflictDialog()).toBeNull();
  });

  it("keeps the conflict up when saving elsewhere cannot run", async () => {
    /*
     * The other half of the same hazard, and the one that loses work.
     *
     * Nothing stops a shortcut while the conflict is on screen: Ctrl+S,
     * Ctrl+O or an export all take the file lock with the three buttons
     * still there to be pressed. "Save as..." used to dismiss the dialog
     * and then call `saveAs`, which declines in silence when the lock is
     * held -- so the reader picked the one answer that protects their
     * buffer, watched the question disappear, and got nothing written and
     * nothing said. The question has to stay until it can be honoured.
     *
     * The dialog still being there is the assertion that discriminates: the
     * empty `save_as` holds either way, because the old code did call
     * `saveAs` and `saveAs` is what declined. It is kept for the other
     * direction -- a future `saveAs` that ignores the lock instead of
     * respecting it would write behind a operation in flight, and this
     * would say so.
     */
    h.dirty = true;
    h.disk = "my edit";
    await mountApp();

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "their edit";
    await tick();
    expect(conflictDialog()).toBeTruthy();

    // Ctrl+S with the write hung: the lock is taken and never given back.
    const inner = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "save_document") return new Promise(() => {});
      return inner(cmd, args);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(
      h.invoke.mock.calls.filter(([cmd]) => cmd === "save_document").length,
      "the shortcut has to reach the backend, or the lock is not held and",
    ).toBeGreaterThan(0);

    vi.mocked(h.invoke).mockClear();
    await clickDialogButton("Save as…");

    expect(
      h.invoke.mock.calls.filter(([cmd]) => cmd === "save_as"),
      "the dialog cannot pick a file while another operation holds the lock",
    ).toEqual([]);
    expect(
      conflictDialog(),
      "so the question stays up, to be answered again when it can be obeyed",
    ).toBeTruthy();
  });

  it("does not raise a conflict on top of an operation that started later", async () => {
    /*
     * The guards at the top of a tick are read once. The body then awaits the
     * fingerprint and the file, and an operation can start in between -- a
     * file dialog, an export, or the question a reload asks.
     *
     * The cost is not cosmetic. A conflict raised then paints a second
     * `aria-modal` over the first, and "save mine elsewhere" answers it by
     * calling `saveAs`, which declines in silence while another operation
     * holds the lock: the dialog goes away, nothing is written, and the
     * buffer the reader chose to protect is the one that loses.
     */
    h.dirty = true;
    h.disk = "my edit";
    await mountApp();

    // Hold the file read open, so a tick is in flight with nothing decided.
    let releaseRead: (text: string) => void = () => {};
    const inner = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "read_document") {
        return new Promise((resolve) => {
          releaseRead = resolve as (text: string) => void;
        });
      }
      if (cmd === "save_document") return new Promise(() => {});
      return inner(cmd, args);
    });

    h.stat = { modifiedMs: 2000, size: 12 };
    await tick();

    // An operation takes the lock while that read is still outstanding.
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      releaseRead("their edit");
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(
      conflictDialog(),
      "a conflict may not be raised over an operation already in progress",
    ).toBeNull();
  });

  it("waits while a question about unsaved work is on screen", async () => {
    /*
     * The watch stands down for a file operation and for a conflict already
     * being answered, but not for a question. Ctrl+W on a dirty document asks
     * whether to lose the edits; if the file moves during those seconds, the
     * poll puts the three-way conflict on top of it. Two modals, each
     * trapping the focus, each asking about the same unsaved work, and the
     * answer to one changes what the other was asked about -- resolving the
     * conflict with "Reload" replaces the buffer the question is still
     * offering to discard.
     *
     * No work is lost either way, which is what makes this smaller than the
     * autosave hole beside it, and no reason to leave it standing.
     *
     * The second half costs nothing to assert and says the pass was deferred
     * rather than dropped. It is free here in a way it was not for autosave:
     * the watch is an interval, so a skipped tick is followed by another one
     * three seconds later without anybody rearming anything.
     */
    h.dirty = true;
    // The file agrees with the buffer, so mounting settles quietly and every
    // change below is this test's doing.
    h.disk = "my edit";
    await mountApp();

    await act(async () => {
      fireEvent.keyDown(window, { key: "w", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(
      screen.queryByText(/has unsaved changes/i),
      "closing a dirty document should ask",
    ).not.toBeNull();

    // Something else rewrites the file while the question is up.
    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "their edit";
    await tick();

    expect(
      conflictDialog(),
      "one question at a time; this one is already about that unsaved work",
    ).toBeNull();

    // They keep the tab. The poll that stood down comes back by itself.
    await clickDialogButton("No");
    await tick();

    expect(
      conflictDialog(),
      "the moment has passed, and the file really did change",
    ).not.toBeNull();
  });
});

describe("saving is not an external change", () => {
  /**
   * Type into the live editor.
   *
   * Through the view, not the DOM: a Range does not reach CodeMirror, and text
   * dispatched any other way lands somewhere other than where it looks.
   */
  function type(text: string) {
    const view = EditorView.findFromDOM(
      document.querySelector(".cm-editor") as HTMLElement,
    );
    if (!view) throw new Error("no EditorView mounted");
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
    });
  }

  /** A save, as the disk sees it: new bytes and a new fingerprint. */
  function diskAcceptsSaves() {
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "save_document") {
        h.disk = String(args?.content ?? "");
        h.stat = { modifiedMs: h.stat.modifiedMs + 500, size: h.disk.length };
        // The write hands its own fingerprint back, which is what the command
        // does now: taken beside the write rather than fetched afterwards.
        return h.stat;
      }
      return original(cmd, args);
    });
  }

  it("does not raise a conflict when the writer keeps typing after a save", async () => {
    /*
     * The race, and it is not hypothetical: a save moves the file's
     * fingerprint, so the next poll reads the disk and compares it to the
     * buffer. Type in between and they differ, the document is dirty again,
     * and the watcher calls that a conflict — over a change this application
     * made itself, seconds ago.
     *
     * Rare with Ctrl+S and constant with an autosave, which is why it is fixed
     * before one exists.
     */
    await mountApp();
    diskAcceptsSaves();

    type(" edited");
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(100);
    });

    // The writer carries on, inside the poll window.
    type(" and more");
    await tick();

    expect(
      conflictDialog(),
      "the file changed because this app saved it; that is not a conflict",
    ).toBeNull();
  });

  it("still raises a conflict when someone else changes the file", async () => {
    // The other half: the guard must not be a blanket "ignore the disk".
    await mountApp();
    diskAcceptsSaves();

    type(" edited");
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(100);
    });

    // Someone else writes the file, and the writer has unsaved work.
    type(" mine");
    h.disk = "theirs";
    h.stat = { modifiedMs: h.stat.modifiedMs + 5000, size: 6 };
    await tick();

    expect(conflictDialog(), "a real outside change still has to be asked about").not.toBeNull();
  });

  it("does not raise a conflict over the file Save As has just created", async () => {
    /*
     * The other half of the same fix, in the other half of the code. Ctrl+S
     * went through the write queue, which adopts the fingerprint; Save As
     * wrote through the file dialog and never did, so the watcher met the new
     * file with no baseline at all — read the disk, compared it to a buffer
     * the writer had carried on typing into, and called that a conflict about
     * a file created three seconds earlier.
     */
    await mountApp();

    // The dialog writes the buffer under a new name, and that file has a
    // fingerprint of its own.
    h.disk2 = "v1 saved elsewhere";
    h.stat2 = { modifiedMs: 9000, size: h.disk2.length };
    type(" saved elsewhere");

    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });
      await vi.advanceTimersByTimeAsync(200);
    });

    // The writer carries on, inside the poll window, as they would.
    type(" and more");
    await tick();

    expect(
      conflictDialog(),
      "this application wrote that file itself, a moment ago",
    ).toBeNull();
  });

  it("still notices a write that landed between the save and its fingerprint", async () => {
    /*
     * The window the fingerprint travelling back with the write closes.
     *
     * The frontend used to save and then ask for the file's fingerprint in a
     * second call. Another process writing in between meant *their*
     * fingerprint was adopted as ours — and from then on the watcher believed
     * the disk matched a buffer it no longer did. Not a conflict raised
     * wrongly: a real change never noticed at all, until something moved the
     * file again.
     *
     * The fixture is that ordering exactly. `save_document` answers with the
     * fingerprint of what it wrote, and the disk moves on immediately
     * afterwards, which is what a `document_stat` a round trip later would
     * have picked up instead.
     */
    await mountApp();

    // The disk takes our write, answers with its fingerprint — and somebody
    // else writes the same file immediately afterwards. Any `document_stat`
    // from here on sees theirs, which is precisely what the second call used
    // to pick up and adopt as ours.
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "save_document") {
        const ours = {
          modifiedMs: h.stat.modifiedMs + 500,
          size: String(args?.content ?? "").length,
        };
        h.disk = "theirs";
        h.stat = { modifiedMs: ours.modifiedMs + 1, size: 6 };
        return ours;
      }
      return original(cmd, args);
    });

    type(" edited");
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(100);
    });

    // The writer carries on, so there is something to lose.
    type(" mine");
    await tick();

    expect(
      conflictDialog(),
      "their write happened; adopting their fingerprint as ours would bury it",
    ).not.toBeNull();
  });
});
