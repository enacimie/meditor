// @vitest-environment jsdom
/**
 * Integration regression test for the "dirty-on-mount" bug class:
 * a document restored from the session (clean, dirty:false) must NOT end up
 * with the dirty indicator after the editor mounts and the app settles.
 *
 * Covers the exact user flow: Tauri load_session returns a clean doc →
 * App restores it → Editor mounts with its content → no onChange spike.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

// --- Mock the Tauri surface used by App on startup ---
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      // A clean restored session — exactly what the user reported as
      // incorrectly showing the dirty dot.
      return {
        docs: [
          {
            id: "restored-1",
            name: "Restored",
            path: null,
            content: "# Restored\n\nThis document was NOT edited.",
            dirty: false,
            handle: null,
          },
        ],
        activeId: "restored-1",
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

// The preview panel is not part of this regression — keep it a stub to
// avoid dragging markdown/mermaid rendering into the test.
vi.mock("./Preview", () => ({
  default: () => <div data-testid="preview-mock" />,
}));

beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
});

beforeEach(() => {
  // jsdom lacks matchMedia — App's compact-layout and useThemeEffect use it.
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

describe("session restore dirty regression", () => {
  it("restores a clean doc without showing the dirty indicator", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Wait until the app is ready AND the real (lazy-loaded) editor mounted.
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    // Let any mount-time listeners/sync effects settle.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The restored doc must not be marked dirty: no bullet on the active tab
    // and no dirty state in the status bar.
    expect(document.querySelector(".tab.active .tab-dirty")).toBeNull();
    expect(document.querySelector(".statusbar-dirty")).toBeNull();

    // Sanity: the restored tab is actually present.
    expect(document.querySelector(".tab.active .tab-name")?.textContent).toBe("Restored");
  });
});
