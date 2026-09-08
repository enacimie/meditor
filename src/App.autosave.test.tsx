// @vitest-environment jsdom
/**
 * Autosave: off unless asked for, and once asked for, careful.
 *
 * The interesting assertions here are the negative ones. Writing a file on a
 * timer is easy; not writing it at the wrong moment is the part that can lose
 * somebody's work — over a conflict they have not answered, or over a document
 * that has no file and would be saved somewhere they never chose.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** Every `save_document` the app has asked for, in order. */
  writes: [] as Array<{ handle: string; content: string }>,
  stat: { modifiedMs: 1000, size: 2 },
  disk: "v1",
  /** The document the session restores: with a file, or one never saved. */
  handle: "h-1" as string | null,
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

function resetInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "platform":
        return "linux";
      case "cli_files":
        return [];
      case "load_session":
        return {
          docs: [
            {
              id: "doc-1",
              name: "notes.md",
              path: h.handle ? "/tmp/notes.md" : null,
              content: "v1",
              dirty: false,
              handle: h.handle,
              kind: "markdown",
            },
          ],
          activeId: "doc-1",
          split: 50,
        };
      case "document_stat":
        return h.stat;
      case "read_document":
        return h.disk;
      case "save_document":
        h.writes.push({
          handle: String(args?.handle ?? ""),
          content: String(args?.content ?? ""),
        });
        h.disk = String(args?.content ?? "");
        h.stat = { modifiedMs: h.stat.modifiedMs + 500, size: h.disk.length };
        return null;
      default:
        return null;
    }
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Past the autosave delay, with room to spare. */
const settle = () => advance(2500);

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
  await advance(3100);
  h.writes.length = 0;
}

/**
 * Advance until the external-change watch has just polled, and stop there.
 *
 * The watch runs on its own three-second interval, started when the app
 * mounted, and nothing in a test knows its phase: `mountApp` and
 * `enableAutosave` both advance the clock by amounts that depend on how many
 * turns their loops needed. A test that wants to place an event between two
 * polls has to find one first, and a poll is visible — it asks the backend for
 * `document_stat`.
 *
 * Advancing in small steps rather than one jump so that the return is as close
 * behind the poll as the resolution allows, leaving nearly the full interval
 * ahead.
 */
async function alignAfterPoll() {
  const polled = () => h.invoke.mock.calls.some(([cmd]) => cmd === "document_stat");
  h.invoke.mockClear();
  for (let i = 0; i < 100 && !polled(); i += 1) {
    await advance(50);
  }
  expect(polled(), "the external-change watch should be polling").toBe(true);
  h.writes.length = 0;
}

/** Type into the live editor, through the view rather than the DOM. */
function type(text: string) {
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
  if (!view) throw new Error("no EditorView mounted");
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
  });
}

/**
 * Turn autosave on the way a person does: through the Preferences dialog.
 *
 * Not by seeding localStorage, which does nothing here — `INITIAL_PREFERENCES`
 * is read once when App.tsx is first imported, long before any test body runs,
 * so a value written in `beforeEach` arrives far too late.
 */
async function enableAutosave() {
  /*
   * The keypress is retried, not merely waited on afterwards.
   *
   * `openPreferences` returns early until the app reports itself ready, so a
   * shortcut sent one beat too soon is not queued — it is dropped, and no
   * amount of waiting afterwards produces a dialog. Diagnosed rather than
   * guessed: the first two tests in this file found no dialog in the DOM at
   * all while the later ones, running against warm modules, found it at once.
   */
  for (let i = 0; i < 100 && !document.getElementById("prefs-autosave"); i += 1) {
    await act(async () => {
      fireEvent.keyDown(window, { key: ",", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  const box = document.getElementById("prefs-autosave") as HTMLInputElement | null;
  expect(box, "the Preferences dialog should offer an autosave switch").toBeTruthy();
  await act(async () => {
    fireEvent.click(box!);
    await vi.advanceTimersByTimeAsync(50);
  });
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
    await vi.advanceTimersByTimeAsync(300);
  });
  h.writes.length = 0;
}

beforeAll(async () => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  /*
   * Load the lazy modules before any fake clock exists.
   *
   * App reaches both of these through `React.lazy`, and a dynamic import does
   * not complete while timers are faked: the first two tests in this file
   * found neither the editor nor the dialog in the DOM at all, however long
   * they advanced the clock and however many times they pressed the shortcut,
   * while every test after them found both immediately. That is a module
   * resolving between tests, on the real timers of `afterEach` — not a defect
   * in the shortcut, which is what it looked like. Resolved once here, they
   * are in hand from the first test on, and the file passes run on its own
   * rather than only when its neighbours warmed the cache first.
   */
  await import("./Editor");
  await import("./components/PreferencesDialog");
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
  h.writes.length = 0;
  h.stat = { modifiedMs: 1000, size: 2 };
  h.disk = "v1";
  h.handle = "h-1";
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("autosave", () => {
  it("writes nothing at all while it is switched off", async () => {
    // The default, and the one that must never change by accident: this
    // editor's model is an explicit save.
    await mountApp();
    type(" edited");
    await settle();
    await settle();
    expect(h.writes).toEqual([]);
  });

  it("writes the document once the typing stops", async () => {
    await mountApp();
    await enableAutosave();
    type(" edited");
    await settle();
    expect(h.writes.map((w) => w.content)).toEqual(["v1 edited"]);
  });

  it("waits for the typing to stop rather than writing on every keystroke", async () => {
    await mountApp();
    await enableAutosave();
    type(" one");
    await advance(500);
    type(" two");
    await advance(500);
    type(" three");
    expect(h.writes, "nothing yet: the writer is still going").toEqual([]);
    await settle();
    expect(h.writes.map((w) => w.content)).toEqual(["v1 one two three"]);
  });

  it("does not write a document that has never been saved", async () => {
    // No file to write to. Picking one on the writer's behalf would put their
    // document somewhere they did not choose.
    h.handle = null;
    await mountApp();
    await enableAutosave();
    type(" edited");
    await settle();
    expect(h.writes).toEqual([]);
  });

  it("writes nothing more once the document is clean", async () => {
    await mountApp();
    await enableAutosave();
    type(" edited");
    await settle();
    expect(h.writes).toHaveLength(1);
    await settle();
    await settle();
    expect(h.writes, "a clean document has nothing to save").toHaveLength(1);
  });

  it("waits for an operation the writer started rather than cutting in", async () => {
    /*
     * A file dialog is open and the writer is standing at it. Autosave takes
     * the same lock every other file operation takes, and waits.
     *
     * Held open with a picker that never answers, which is what an open dialog
     * is from the application's side.
     */
    await mountApp();
    await enableAutosave();

    const inner = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "open_files") return new Promise(() => {});
      return inner(cmd, args);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(50);
    });
    type(" typed while the picker is up");
    await settle();
    await settle();
    expect(h.writes, "the writer is in a dialog; this is not the moment").toEqual([]);
  });

  it("writes nothing while a conflict is waiting to be answered", async () => {
    /*
     * The assertion that can cost somebody their work. While the dialog is up
     * the whole question is which version wins, and a timer that answers it by
     * writing has answered it for them.
     *
     * Getting a conflict on screen with autosave running takes some doing,
     * because an autosave normally beats the watcher to the file and adopts
     * the fingerprint. A save that fails leaves the document dirty and the
     * fingerprint alone, which is exactly the state a read-only file produces,
     * and it lets the poll find a genuine outside change.
     */
    await mountApp();
    await enableAutosave();

    let failWrites = true;
    const inner = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "save_document" && failWrites) throw new Error("read-only");
      return inner(cmd, args);
    });

    type(" mine");
    await settle();
    expect(h.writes, "the failed write never reached the disk").toEqual([]);

    // Somebody else writes the file while this one is still unsaved.
    h.disk = "theirs";
    h.stat = { modifiedMs: h.stat.modifiedMs + 9999, size: 6 };
    await advance(3100);
    expect(
      document.querySelector(".conflict-overlay"),
      "the fixture should have produced a conflict to guard against",
    ).not.toBeNull();

    // Writing works again, and the writer keeps typing behind the dialog.
    failWrites = false;
    type(" more");
    await settle();
    await settle();
    expect(
      h.writes,
      "a document whose fate the writer has not decided must not be written",
    ).toEqual([]);
  });

  it("does not raise a conflict over its own writing", async () => {
    /*
     * The reason the fix in the previous change had to come first. An autosave
     * moves the file's fingerprint every couple of seconds; without adopting
     * it, the watcher reads each of those back as somebody else's edit and
     * asks the writer about it.
     *
     * Written against the clock rather than around it, because the obvious
     * version of this test does not fail when the guard is taken away. The
     * watch polls every three seconds and an autosave lands two seconds after
     * the typing stops, so a poll that happens to fall in between finds the
     * file and the buffer agreeing and refreshes the baseline itself — the
     * right answer, reached by luck, and the test cannot tell the two apart.
     * Confirmed by removing the fingerprint adoption and watching this pass.
     *
     * So the poll is found first, and everything after it is placed inside
     * the three seconds that follow.
     */
    await mountApp();
    await enableAutosave();
    await alignAfterPoll();

    type(" edited");
    // The write lands at 2000; the next poll is not due until 3000.
    await advance(2100);
    expect(h.writes, "the autosave should have written inside the window").toHaveLength(1);

    // The writer carries on before that poll, so it finds a file that moved
    // and a buffer that no longer matches it.
    type(" and more");
    await advance(3100);
    expect(
      document.querySelector(".conflict-overlay"),
      "the file changed because autosave wrote it; that is not a conflict",
    ).toBeNull();
  });

  it("takes its failure notice down once a write works again", async () => {
    /*
     * The notice has no timer and nothing else clears it, because a message
     * saying the work is not being saved should not fade away while it is
     * still true. The other half of that decision is this one: when the drive
     * comes back the message has to go, or the application spends the rest of
     * the session claiming a file it is writing every two seconds cannot be
     * written.
     */
    await mountApp();
    await enableAutosave();

    let failWrites = true;
    const inner = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "save_document" && failWrites) throw new Error("read-only");
      return inner(cmd, args);
    });

    type(" mine");
    await settle();
    expect(
      document.querySelector(".app-notice.error"),
      "a file that cannot be written has to be said out loud",
    ).not.toBeNull();

    failWrites = false;
    type(" more");
    await settle();

    expect(h.writes.length, "the retry should have reached the disk").toBeGreaterThan(0);
    expect(
      document.querySelector(".app-notice.error"),
      "the file is being written again; the warning is no longer true",
    ).toBeNull();
  });
});
