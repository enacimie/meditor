// @vitest-environment jsdom
/**
 * Zen mode shows the writing placeholder on an empty document.
 *
 * Editor already accepted `zenMode`/`zenPlaceholder` and reconfigured its
 * CodeMirror compartment accordingly, and the `zen.placeholder` string existed
 * in all 104 languages — but App never passed the props, so the feature was
 * unreachable.
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
            id: "zen-1",
            name: "Empty",
            path: null,
            content: "",
            dirty: false,
            handle: null,
          },
        ],
        activeId: "zen-1",
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

describe("zen mode placeholder", () => {
  it("appears on entering zen mode and disappears on leaving", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });

    // Outside zen mode the empty document shows no placeholder.
    expect(document.querySelector(".cm-placeholder")).toBeNull();

    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(document.querySelector(".app.zen")).toBeTruthy());
    await waitFor(() => {
      const placeholder = document.querySelector(".cm-placeholder");
      expect(placeholder).toBeTruthy();
      expect(placeholder?.textContent).toBe("Start writing...");
    });

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".app.zen")).toBeNull());
    await waitFor(() =>
      expect(document.querySelector(".cm-placeholder")).toBeNull(),
    );
  });
});
