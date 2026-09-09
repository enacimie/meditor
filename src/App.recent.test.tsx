// @vitest-environment jsdom
/**
 * Reopening a recent document that is no longer there.
 *
 * The list is a promise the application makes about files it does not own,
 * and the promise breaks all the time: files get moved, renamed, deleted, or
 * live on a drive that is not plugged in this morning. What the writer is
 * told when they click one of those is the whole subject here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** What `recent_files` answers, which the app re-reads after a failure. */
  entries: [] as Array<{ name: string; path: string }>,
  /** What `open_recent` does: hand back a document, nothing, or throw. */
  open: "throws" as "throws" | "nothing",
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

/** The words the operating system uses, which is what this change is about. */
const OS_ERROR = "The system cannot find the file specified. (os error 2)";

function resetInvoke() {
  h.invoke.mockImplementation(async (cmd: string) => {
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
              name: "open.md",
              path: "/tmp/open.md",
              content: "hello",
              dirty: false,
              handle: "h-1",
              kind: "markdown",
            },
          ],
          activeId: "doc-1",
          split: 50,
        };
      case "recent_files":
        return h.entries;
      case "save_document":
        return null;
      case "open_recent":
        if (h.open === "nothing") return null;
        throw new Error(OS_ERROR);
      default:
        return null;
    }
  });
}

/**
 * Open the "⋯" menu and wait for the remembered documents to be drawn.
 *
 * Separate from the click so a test can change what a re-read of the list
 * will answer while the menu is already on screen — which is the situation
 * being tested, and which cannot be arranged afterwards: the click starts the
 * re-read before a test body gets control again.
 */
async function openRecentMenu() {
  const toggle = await screen.findByRole("button", { name: /more options/i });
  fireEvent.click(toggle);
  return waitFor(() => {
    const found = document.querySelector(".menu-recent");
    if (!found) throw new Error("the recent section drew no documents");
    return found as HTMLElement;
  });
}

function noticeText(): string {
  return document.querySelector(".app-notice")?.textContent ?? "";
}

/** Every `alert` the app asked the backend to put on screen. */
function nativeAlerts(): string[] {
  return h.invoke.mock.calls
    .filter(([cmd]) => cmd === "alert")
    .map(([, args]) => String((args as { message?: unknown })?.message ?? ""));
}

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
  h.entries = [{ name: "notes.md", path: "/tmp/notes.md" }];
  h.open = "throws";
  /*
   * Cleared, not just re-implemented.
   *
   * `vi.restoreAllMocks` undoes spies and leaves a `vi.fn()` alone, and
   * `resetInvoke` only reinstalls the implementation — so the call log
   * accumulates across the file. The tests below count calls, and a count
   * carried over from the test before is a test that passes for the wrong
   * reason.
   */
  h.invoke.mockClear();
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountApp() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe("reopening a recent document", () => {
  it("names the document that has gone instead of quoting the operating system", async () => {
    /*
     * The backend answers with nothing when there is nothing to open —
     * whether the position went away between the menu being drawn and the
     * click, or the file itself did. Both are the same event to the person
     * who clicked, and both deserve the document's name rather than the
     * operating system's words for it.
     */
    h.open = "nothing";
    mountApp();
    const row = await openRecentMenu();
    h.entries = [];
    fireEvent.click(row);

    await waitFor(() => expect(noticeText()).toContain("notes.md"));
    expect(noticeText(), "the writer should not be shown an errno").not.toContain("os error");
    expect(nativeAlerts(), "and should not have to dismiss a modal for it").toEqual([]);
  });

  it("still hands over the details when the file is there and something else went wrong", async () => {
    // The other half: this must not become a blanket "never mind why".
    mountApp();
    // The list keeps it, so whatever failed, it was not the file going
    // missing — a locked file, a bad encoding, a full disk.
    fireEvent.click(await openRecentMenu());

    await waitFor(() => expect(nativeAlerts()).toHaveLength(1));
    expect(nativeAlerts()[0]).toContain(OS_ERROR);
    expect(noticeText()).not.toContain("notes.md");
  });

  it("hands them over even when the entry has vanished from the list", async () => {
    /*
     * The mislabel this replaced. The decision used to be made here, by
     * re-reading the list and seeing whether the entry survived — and the
     * pruning drops a path on *any* metadata error, not only on absence. A
     * share that is not mounted and a permission that changed were both
     * reported as "no longer where it was", with the real reason going to
     * the console where nobody would look.
     *
     * The backend decides now, and an error means the file is there and
     * would not open, whatever the list says afterwards.
     */
    mountApp();
    const row = await openRecentMenu();
    h.entries = [];
    fireEvent.click(row);

    await waitFor(() => expect(nativeAlerts()).toHaveLength(1));
    expect(
      nativeAlerts()[0],
      "an error is an error even if the row is gone from the menu",
    ).toContain(OS_ERROR);
  });
});

describe("the list after a save", () => {
  /** How many times the app has asked the backend for the list. */
  const reads = () => h.invoke.mock.calls.filter(([cmd]) => cmd === "recent_files").length;

  async function mountAndSettle() {
    mountApp();
    await screen.findByRole("button", { name: /more options/i });
    await waitFor(() => expect(reads()).toBeGreaterThan(0));
  }

  it("re-reads it when the save moved the document to the front", async () => {
    /*
     * Saving promotes the document in the backend's list, and the menu is
     * clicked by *position*. A stale copy therefore does not merely look out
     * of date: click the row labelled `notes.md` after saving `open.md`, and
     * the index that travels is the one `open.md` now occupies.
     */
    h.entries = [
      { name: "notes.md", path: "/tmp/notes.md" },
      { name: "open.md", path: "/tmp/open.md" },
    ];
    await mountAndSettle();
    const before = reads();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() =>
      expect(reads(), "the menu is about to disagree with the backend").toBeGreaterThan(before),
    );
  });

  it("leaves it alone when the document is already at the front", async () => {
    // `remember` returns early in that case and rewrites nothing, so a read
    // here would be a round trip for no change — every couple of seconds,
    // once autosave is on.
    h.entries = [
      { name: "open.md", path: "/tmp/open.md" },
      { name: "notes.md", path: "/tmp/notes.md" },
    ];
    await mountAndSettle();
    const before = reads();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(document.querySelector(".app-notice")).not.toBeNull());

    expect(reads(), "nothing moved, so there was nothing to re-read").toBe(before);
  });
});
