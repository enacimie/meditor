// @vitest-environment jsdom
/**
 * Which paper a document is laid out on, when the document has an opinion.
 *
 * The reader's preference says what is in their printer. `papersize` in the
 * front-matter says what the document is. They disagree often — a thesis
 * written on Letter opened by somebody whose preference is A4 — and this is
 * about which one wins, checked where it can actually be seen: the paper name
 * the print command is given.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** The body of the one open document, front-matter and all. */
  content: "# Notes\n",
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
              path: "/tmp/notes.md",
              content: h.content,
              dirty: false,
              handle: "h-1",
              kind: "markdown",
            },
          ],
          activeId: "doc-1",
          split: 50,
        };
      default:
        return null;
    }
  });
}

/** Print, and answer with the paper the command was given. */
async function paperUsedForPrinting(): Promise<string | null> {
  fireEvent.keyDown(window, { key: "p", ctrlKey: true });
  return waitFor(() => {
    const call = h.invoke.mock.calls.find(([cmd]) => cmd === "print_document");
    if (!call) throw new Error("nothing was printed");
    return (call[1] as { paper?: string | null })?.paper ?? null;
  });
}

/** Wait for the app to be ready enough that its shortcuts do anything. */
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

/**
 * Set the reader's preference to Letter, the way a person does.
 *
 * Not by seeding localStorage: the stored preferences are read once when
 * App.tsx is first imported, long before any test body runs.
 */
async function preferLetter() {
  await waitFor(() => {
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    if (!document.getElementById("prefs-paper")) throw new Error("no dialog yet");
  });
  const select = document.getElementById("prefs-paper") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "letter" } });
  /*
   * Escape goes to the overlay, not to the window.
   *
   * The dialog handles the key with React's own `onKeyDown` on its outermost
   * element, so the event has to start somewhere inside it and bubble. Fired
   * at `window` it never reaches the handler and the dialog stays up, holding
   * the shortcut this test needs next.
   */
  const overlay = document.querySelector(".prefs-overlay") as HTMLElement;
  fireEvent.keyDown(overlay, { key: "Escape" });
  await waitFor(() => {
    if (document.getElementById("prefs-paper")) throw new Error("dialog still up");
  });
}

beforeAll(async () => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  // Both reached through `React.lazy`; resolved here so no test waits on a
  // dynamic import in the middle of an assertion.
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
  h.content = "# Notes\n";
  // Cleared, not just re-implemented: the assertions read the call history,
  // and a print from the previous test would answer for this one.
  h.invoke.mockClear();
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the paper a document asks for", () => {
  it("uses the preference when the document says nothing", async () => {
    await mountApp();
    expect(await paperUsedForPrinting()).toBe("a4");
  });

  it("follows the front-matter instead", async () => {
    h.content = "---\npapersize: letter\n---\n\n# Notes\n";
    await mountApp();
    expect(await paperUsedForPrinting()).toBe("letter");
  });

  it("beats the preference, because the paper belongs to the document", async () => {
    /*
     * The assertion the whole change is for. The reader prefers Letter; the
     * document was written for A4 and says so. Repaginating it to suit
     * whoever opened it is the failure this prevents.
     */
    h.content = "---\npapersize: a4\n---\n\n# Notes\n";
    await mountApp();
    await preferLetter();
    expect(await paperUsedForPrinting()).toBe("a4");
  });

  it("leaves the preference in charge when the document names a paper it does not know", async () => {
    // A typo must not quietly overrule a setting the reader made on purpose.
    h.content = "---\npapersize: foolscap\n---\n\n# Notes\n";
    await mountApp();
    await preferLetter();
    expect(await paperUsedForPrinting()).toBe("letter");
  });
});
