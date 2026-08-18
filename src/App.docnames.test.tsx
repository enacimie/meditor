// @vitest-environment jsdom
/**
 * Names given to untitled documents.
 *
 * The unit tests for `nextUntitledName` cover the arithmetic; this covers the
 * situation that made it wrong in the first place — a restored session, whose
 * documents the app has to take into account before naming a new one.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

/** Session the backend hands back on launch: Doc 1 and Doc 2 already taken. */
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      return {
        docs: [
          {
            id: "restored-1",
            name: "Doc 1",
            path: null,
            content: "# restored one",
            dirty: false,
            handle: null,
          },
          {
            id: "restored-2",
            name: "Doc 2",
            path: null,
            content: "# restored two",
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

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

vi.mock("./Preview", () => ({ default: () => <div data-testid="preview-mock" /> }));

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
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tabNames = () =>
  [...document.querySelectorAll('[role="tab"]')].map((el) =>
    (el.textContent ?? "").replace(/[•×\s]+/g, " ").trim(),
  );

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

describe("naming untitled documents", () => {
  it("does not reuse a name the restored session already has", async () => {
    await renderApp();
    await waitFor(() => expect(tabNames()).toHaveLength(2));

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await waitFor(() => expect(tabNames()).toHaveLength(3));

    const names = tabNames();
    expect(new Set(names).size).toBe(names.length);
    // The counter this replaces restarted at zero on launch, so the new tab
    // called itself Doc 1 — a second tab with that name.
    expect(names).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
  });

  it("keeps every name distinct as tabs pile up", async () => {
    await renderApp();
    await waitFor(() => expect(tabNames()).toHaveLength(2));

    for (let i = 0; i < 3; i += 1) {
      const before = tabNames().length;
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
      await waitFor(() => expect(tabNames()).toHaveLength(before + 1));
    }

    const names = tabNames();
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    expect(names).toEqual(["Doc 1", "Doc 2", "Doc 3", "Doc 4", "Doc 5"]);
  });
});
