// @vitest-environment jsdom
/**
 * Integration test for the in-window rename dialog.
 *
 * Double-clicking a tab must open the HTML RenameDialog (NOT the native
 * window.prompt) and, on confirm, update the tab name. In jsdom
 * window.prompt is a stub that returns null, so a working rename proves the
 * prompt is no longer on the rename path.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      return {
        docs: [
          {
            id: "rename-1",
            name: "Original",
            path: null,
            content: "# rename me",
            dirty: false,
            handle: null,
          },
        ],
        activeId: "rename-1",
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("in-window rename dialog", () => {
  it("double-clicking the tab opens the rename dialog instead of window.prompt", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.doubleClick(document.querySelector(".tab-main")!);

    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeTruthy(),
    );
    const input = document.querySelector<HTMLInputElement>(".rename-input")!;
    expect(input).not.toBeNull();
    // The dialog opens pre-filled with the current name.
    expect(input.value).toBe("Original");
  });

  it("renames the tab when confirmed", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.doubleClick(document.querySelector(".tab-main")!);
    await waitFor(() =>
      expect(document.querySelector(".rename-input")).toBeTruthy(),
    );

    const input = document.querySelector<HTMLInputElement>(".rename-input")!;
    fireEvent.change(input, { target: { value: "Renamed Tab" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Dialog closes and the tab shows the new name.
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    await waitFor(() =>
      expect(document.querySelector(".tab-name")?.textContent).toBe("Renamed Tab"),
    );
  });

  it("F2 opens the rename dialog and can rename the active tab end-to-end", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.keyDown(window, { key: "F2" });
    await waitFor(() =>
      expect(document.querySelector(".rename-input")).toBeTruthy(),
    );
    const input = document.querySelector<HTMLInputElement>(".rename-input")!;
    expect(input.value).toBe("Original");

    // Type a new name and confirm — the shortcut path must rename for real.
    fireEvent.change(input, { target: { value: "F2 Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    await waitFor(() =>
      expect(document.querySelector(".tab-name")?.textContent).toBe("F2 Renamed"),
    );
  });

  it("keeps the original name when cancelled", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.doubleClick(document.querySelector(".tab-main")!);
    await waitFor(() =>
      expect(document.querySelector(".rename-input")).toBeTruthy(),
    );

    const input = document.querySelector<HTMLInputElement>(".rename-input")!;
    fireEvent.change(input, { target: { value: "Should Not Apply" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    expect(document.querySelector(".tab-name")?.textContent).toBe("Original");
  });
});
