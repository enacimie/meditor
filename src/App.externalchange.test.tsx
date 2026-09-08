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
  dirty: false,
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
        return h.stat;
      case "read_document":
        return h.disk;
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
  h.dirty = false;
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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
        return null;
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
});
