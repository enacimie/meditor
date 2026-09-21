// @vitest-environment jsdom
/**
 * Reloading the open document from its file, on purpose.
 *
 * The watch reloads a clean document by itself when it sees the file move,
 * and that covers most of it. This is the command for when it cannot: an
 * editor that rewrites a file without moving its fingerprint, or a reader who
 * wants to be sure rather than to trust a poll.
 *
 * The assertions that matter are about what it must not do. It takes the file
 * whole, so unsaved work is gone — and it may never do that without asking.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** What the file says now, which is not what the buffer says. */
  disk: "the file as it is now",
  stat: { modifiedMs: 9000, size: 21 },
  /** The document the session restores: with a file, or never saved. */
  handle: "h-1" as string | null,
  dirty: false,
  /** Set to make the read fail, the way an unplugged drive does. */
  readFails: false,
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
              name: "notes.md",
              path: h.handle ? "/tmp/notes.md" : null,
              content: "what the buffer holds",
              dirty: h.dirty,
              handle: h.handle,
              kind: "markdown",
              // Matching the disk, so the watch has nothing to say and every
              // change below is the command's doing rather than the poll's.
              stat: h.stat,
            },
          ],
          activeId: "doc-1",
          split: 50,
        };
      case "document_stat":
        return h.stat;
      case "read_document":
        if (h.readFails) throw new Error("the drive is not there");
        return h.disk;
      default:
        return null;
    }
  });
}

/** Open the "⋯" menu and press "Reload from disk", if it is there. */
async function reload(): Promise<boolean> {
  const toggle = await screen.findByRole("button", { name: /more options/i });
  fireEvent.click(toggle);
  const row = await screen.findByRole("menu");
  const button = [...row.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Reload from disk"),
  );
  if (!button) return false;
  fireEvent.click(button);
  return true;
}

function editorText(): string {
  return document.querySelector(".cm-content")?.textContent ?? "";
}

beforeAll(async () => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  // App reaches the editor through `React.lazy`; resolved here so no test
  // waits on a dynamic import in the middle of an assertion.
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
  h.disk = "the file as it is now";
  h.stat = { modifiedMs: 9000, size: 21 };
  h.handle = "h-1";
  h.dirty = false;
  h.readFails = false;
  h.invoke.mockClear();
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mountApp() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  await waitFor(() => {
    if (!document.querySelector(".cm-editor")) throw new Error("no editor yet");
  });
}

describe("reloading from disk", () => {
  it("takes what the file says", async () => {
    await mountApp();
    expect(editorText()).toContain("what the buffer holds");

    expect(await reload(), "the command should be in the menu").toBe(true);

    await waitFor(() => expect(editorText()).toContain("the file as it is now"));
    expect(
      document.querySelector(".tab.active .tab-dirty"),
      "a buffer that is the file is not unsaved",
    ).toBeNull();
  });

  it("asks first when there is unsaved work, and does nothing if told no", async () => {
    /*
     * The assertion that can cost somebody their afternoon. This command
     * takes the file whole; on a dirty document that is a deletion, and it
     * may not happen because a menu row was a pixel from another one.
     */
    h.dirty = true;
    await mountApp();
    await reload();

    const confirm = await screen.findByText(/unsaved changes/i);
    expect(confirm, "it has to ask").toBeTruthy();
    expect(editorText(), "and nothing moves before the answer").toContain(
      "what the buffer holds",
    );

    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(screen.queryByText(/unsaved changes/i)).toBeNull());
    expect(editorText(), "no means no").toContain("what the buffer holds");
  });

  it("lets nothing write the file while the question is on screen", async () => {
    /*
     * The danger this stands for is autosave. It writes two seconds after the
     * last edit and stands down only while a file operation is in flight, so
     * if this command asked before taking that lock, a pass would land while
     * the dialog was still up: the buffer this command exists to discard
     * would become the file, and "Yes" would read it straight back. The
     * writer would have asked to get their file back and been handed their
     * own unsaved work, with the file gone.
     *
     * The lock is one ref, and Save reads the same one — which is how it can
     * be seen from outside the component.
     */
    h.dirty = true;
    await mountApp();
    await reload();
    await screen.findByText(/unsaved changes/i);

    fireEvent.click(screen.getByRole("button", { name: /Save \(Ctrl/ }));
    // Long enough for a click that got through to reach the backend.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      h.invoke.mock.calls.filter(([cmd]) => cmd === "save_document"),
      "nothing may write the file between the question and the answer",
    ).toEqual([]);
  });

  it("reloads once the answer is yes", async () => {
    h.dirty = true;
    await mountApp();
    await reload();
    await screen.findByText(/unsaved changes/i);

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(editorText()).toContain("the file as it is now"));
  });

  it("is not offered for a document that has no file", async () => {
    // There is nothing to read back, and a row that cannot act teaches
    // nothing by being there.
    h.handle = null;
    await mountApp();
    expect(await reload()).toBe(false);
  });

  it("says so when the file cannot be read, and keeps the buffer", async () => {
    h.readFails = true;
    await mountApp();
    await reload();

    await waitFor(() =>
      expect(document.querySelector(".app-notice.error")?.textContent ?? "").toContain(
        "Could not reload",
      ),
    );
    expect(editorText(), "a failed read must not empty the document").toContain(
      "what the buffer holds",
    );
  });

  it("adopts the file's fingerprint, so the watch does not reload it again", async () => {
    /*
     * Without this the next poll finds a file whose fingerprint has moved
     * since the baseline and reads it all over again — and a writer who
     * starts typing within three seconds of asking for a reload would be
     * asked about a conflict over the reload they just requested.
     */
    await mountApp();
    h.stat = { modifiedMs: 12345, size: 21 };
    await reload();
    await waitFor(() => expect(editorText()).toContain("the file as it is now"));

    const stats = h.invoke.mock.calls.filter(([cmd]) => cmd === "document_stat");
    expect(stats.length, "the reload should have asked for the fingerprint").toBeGreaterThan(0);
  });
});
