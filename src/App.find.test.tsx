// @vitest-environment jsdom
/**
 * Ctrl+F from anywhere in the window.
 *
 * The menu lists Find with Ctrl+F, but the key used to reach only
 * CodeMirror's own keymap, so it did nothing unless the editor already had
 * focus. These pin the window-level Ctrl+F: what it does from outside the
 * editor, and every place it must stay out of.
 *
 * Keys are fired at whatever has focus, as a keyboard delivers them, so the
 * handler sees the same target it would in the app.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const session = vi.hoisted(() => ({ content: "" }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      return {
        docs: [
          {
            id: "find-1",
            name: "Doc",
            path: null,
            content: session.content,
            dirty: false,
            handle: null,
          },
        ],
        activeId: "find-1",
        split: 50,
      };
    }
    return null;
  }),
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

// The slides themselves do not matter here, only that a presentation is up
// and can be left.
vi.mock("./components/PresentOverlay", () => ({
  default: ({ onExit }: { onExit: () => void }) => (
    <div className="present-overlay" role="dialog" aria-modal="true">
      <button type="button" className="present-exit" onClick={onExit}>
        exit
      </button>
    </div>
  ),
}));

beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects =
      function () {
        return [] as unknown as DOMRectList;
      };
  }
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
  session.content = "# hello\n\nSome text to look for.";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderApp() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
    timeout: 8000,
  });
}

const app = () => document.querySelector<HTMLElement>(".app")!;
const findField = () => document.querySelector<HTMLInputElement>(".cm-search .cm-textfield");
const tab = () => document.querySelector<HTMLElement>('[role="tab"]')!;

/** Ctrl+F delivered where a keyboard would: to the focused element. */
function pressCtrlF() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "f", ctrlKey: true });
}

/** A press that should have done nothing: give a late reaction time to show. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Ctrl+F from outside the editor", () => {
  it("opens the find panel and puts the caret in its field", async () => {
    await renderApp();
    tab().focus();
    expect(document.activeElement).toBe(tab());
    expect(document.querySelector(".cm-search")).toBeNull();

    pressCtrlF();
    await waitFor(() => expect(findField()).toBeTruthy());
    expect(document.activeElement).toBe(findField());
  });

  it("leaves another field its focus, and finds again once focus is back outside", async () => {
    await renderApp();
    const foreign = document.createElement("input");
    document.body.appendChild(foreign);
    try {
      foreign.focus();
      pressCtrlF();
      await settle();
      expect(document.querySelector(".cm-search")).toBeNull();
      expect(document.activeElement).toBe(foreign);

      // The guard has to let go, or "did nothing" would also describe a
      // shortcut that never works again.
      tab().focus();
      pressCtrlF();
      await waitFor(() => expect(document.activeElement).toBe(findField()));
    } finally {
      foreign.remove();
    }
  });

  it("does not open the panel behind the shortcuts overlay", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() => expect(document.querySelector(".shortcuts-overlay")).toBeTruthy());

    pressCtrlF();
    await settle();
    expect(document.querySelector(".cm-search")).toBeNull();

    fireEvent.keyDown(document.querySelector(".shortcuts-overlay")!, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".shortcuts-overlay")).toBeNull());
    tab().focus();
    pressCtrlF();
    await waitFor(() => expect(document.activeElement).toBe(findField()));
  });

  it("stays out of a presentation, and finds again once it ends", async () => {
    session.content = "---\nmarp: true\n---\n\n# Slide";
    await renderApp();
    fireEvent.click(document.querySelector(".menu-toggle")!);
    const present = await waitFor(() => {
      const item = [...document.querySelectorAll<HTMLElement>('#app-menu [role="menuitem"]')].find(
        (el) => el.textContent?.trim() === "Present",
      );
      expect(item).toBeTruthy();
      return item!;
    });
    fireEvent.click(present);
    await waitFor(() => expect(document.querySelector(".present-overlay")).toBeTruthy());

    // Focus sits on the menu button the entry handed it back to, which is
    // outside the editor: exactly where Ctrl+F is meant to act, but for the
    // slideshow covering it.
    pressCtrlF();
    await settle();
    expect(document.querySelector(".cm-search")).toBeNull();

    fireEvent.click(document.querySelector(".present-exit")!);
    await waitFor(() => expect(document.querySelector(".present-overlay")).toBeNull());
    tab().focus();
    pressCtrlF();
    await waitFor(() => expect(document.activeElement).toBe(findField()));
  });

  it("closes the menu it is pressed from, as the menu's own Find entry does", async () => {
    await renderApp();
    fireEvent.click(document.querySelector(".menu-toggle")!);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("role")).toBe("menuitem"),
    );

    pressCtrlF();
    await waitFor(() => expect(document.querySelector("#app-menu")).toBeNull());
    expect(document.activeElement).toBe(findField());
  });

  it("in preview-only mode, brings the editor back beside the preview", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));
    tab().focus();

    pressCtrlF();
    await waitFor(() => expect(app().className).not.toContain("layout-"));
    await waitFor(() => expect(document.activeElement).toBe(findField()));
  });

  it("in zen mode, finds without changing the layout zen goes back to", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(app().classList.contains("zen")).toBe(true));

    // Zen hides the tab bar, so this is Ctrl+F with nothing in particular
    // focused.
    (document.activeElement as HTMLElement | null)?.blur();
    pressCtrlF();
    await waitFor(() => expect(document.activeElement).toBe(findField()));

    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(app().classList.contains("zen")).toBe(false));
    expect(app().classList.contains("layout-preview")).toBe(true);
  });
});
