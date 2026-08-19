// @vitest-environment jsdom
/**
 * Integration tests for keyboard shortcuts.
 *
 * - The F1 shortcuts overlay: previously dead code, this pins the wiring.
 * - The tab and quit shortcuts (Ctrl+T, Ctrl+Shift+T, Ctrl+Q).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      return {
        docs: [
          {
            id: "shortcuts-1",
            name: "Doc",
            path: null,
            content: "# hello",
            dirty: false,
            handle: null,
          },
        ],
        activeId: "shortcuts-1",
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
  invokeMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tabNames = () =>
  [...document.querySelectorAll('[role="tab"]')].map((el) =>
    (el.textContent ?? "").replace(/[•×\s]+/g, " ").trim(),
  );

describe("shortcuts overlay (F1)", () => {
  it("F1 opens the overlay and Esc closes it", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    // The overlay is dead code unless wired — assert it starts closed.
    expect(document.querySelector(".shortcuts-overlay")).toBeNull();

    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() =>
      expect(document.querySelector(".shortcuts-overlay")).toBeTruthy(),
    );

    // It lists the shortcuts (F2 row proves the content renders).
    expect(
      Array.from(document.querySelectorAll(".shortcuts-row")).some((row) =>
        row.textContent?.includes("F2"),
      ),
    ).toBe(true);

    fireEvent.keyDown(document.querySelector(".shortcuts-overlay")!, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(document.querySelector(".shortcuts-overlay")).toBeNull(),
    );
  });

  it("Ctrl+K focuses the CodeMirror search panel", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    // The search panel is closed by default.
    expect(document.querySelector(".cm-search")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() =>
      expect(document.querySelector(".cm-search")).toBeTruthy(),
    );

    // The find input receives focus.
    const input = document.querySelector<HTMLInputElement>(".cm-textfield")!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("Ctrl+K does not steal focus from the language picker input", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    // Focus a foreign input (simulates the LanguagePicker/rename search box).
    const foreign = document.createElement("input");
    foreign.className = "foreign-input";
    document.body.appendChild(foreign);
    foreign.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    // The editor search panel must NOT open — focus is not stolen.
    expect(document.querySelector(".cm-search")).toBeNull();
    expect(document.activeElement).toBe(foreign);
    foreign.remove();
  });

  it("Escape exits Zen mode and exposes a visible exit control", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(document.querySelector(".app.zen")).toBeTruthy());
    expect(document.querySelector(".zen-exit")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".app.zen")).toBeNull());
  });

  it("F1 is open-only: it re-opens after an animated close but never closes", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() =>
      expect(document.querySelector(".shortcuts-overlay")).toBeTruthy(),
    );

    // F1 while open must NOT close (closing routes through Esc/backdrop/✕).
    fireEvent.keyDown(window, { key: "F1" });
    expect(document.querySelector(".shortcuts-overlay")).not.toBeNull();

    // Close via the backdrop click (targets the overlay, not the panel).
    fireEvent.click(document.querySelector(".shortcuts-overlay")!);
    await waitFor(() =>
      expect(document.querySelector(".shortcuts-overlay")).toBeNull(),
    );

    // Open again with F1.
    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() =>
      expect(document.querySelector(".shortcuts-overlay")).toBeTruthy(),
    );
  });
});

describe("tab and quit shortcuts", () => {
  it("Ctrl+T opens a new tab, like Ctrl+N", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });
    await waitFor(() => expect(tabNames()).toHaveLength(1));

    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(2));
    expect(tabNames()).toEqual(["Doc", "Doc 1"]);
  });

  it("Ctrl+Shift+T reopens the most recently closed tab", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });
    await waitFor(() => expect(tabNames()).toHaveLength(1));

    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(2));

    // Close the active tab (Doc 1), leaving only Doc.
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(1));

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(2));
    expect(tabNames()).toEqual(["Doc", "Doc 1"]);
  });

  it("Ctrl+Shift+T replaces the empty tab left after closing the last one", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });
    await waitFor(() => expect(tabNames()).toHaveLength(1));

    // Close the only tab: the app leaves an empty "Doc 1" placeholder behind.
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(1));

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(1));
    // The placeholder is replaced by the reopened tab, not duplicated next to it.
    expect(tabNames()).toEqual(["Doc"]);
  });

  it("Ctrl+Q quits the app", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });

    fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("exit_app"));
  });

  it("Ctrl+P opens the native print dialog", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("print_document", expect.anything()));
  });
});
