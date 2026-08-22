// @vitest-environment jsdom
/**
 * The web build: with no Tauri runtime at all, the app must restore its
 * localStorage session, edit, and route Ctrl+S through the browser backend
 * (no live handle → Save As → download), persisting the session afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
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

const SESSION_KEY = "meditor.web.session.v3";

function seedSession() {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      version: 3,
      activeId: "d1",
      split: 50,
      docs: [
        {
          id: "d1",
          name: "hello.md",
          path: "hello.md",
          content: "# hello web",
          dirty: false,
          kind: "markdown",
        },
      ],
    }),
  );
}

beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
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
  window.URL.createObjectURL = vi.fn(() => "blob:mock");
  window.URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
  localStorage.clear();
  seedSession();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("web build", () => {
  it("restores the localStorage session and saves through download", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    // The seeded session document came back, not the sample.
    expect(document.querySelector(".tab.active .tab-name")?.textContent).toBe("hello.md");
    expect(document.querySelector(".cm-content")?.textContent).toContain("# hello web");

    // Ctrl+S with no live handle routes through Save As, which on this
    // browser (no File System Access API in jsdom) means a download.
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    });
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);

    // The session writer keeps persisting state (debounced).
    await vi.waitFor(() => {
      const stored = localStorage.getItem(SESSION_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as { version: number; docs: unknown[] };
      expect(parsed.version).toBe(3);
      expect(parsed.docs).toHaveLength(1);
    });
  });
});
