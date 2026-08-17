// @vitest-environment jsdom
/**
 * Ctrl+Tab / Ctrl+Shift+Tab cycle through the open tabs.
 *
 * The README and the shortcuts overlay have always advertised these, but no
 * handler existed: the keys did nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const DOCS = ["one", "two", "three"].map((name, index) => ({
  id: `tab-${index + 1}`,
  name,
  path: null,
  content: `# ${name}`,
  dirty: false,
  handle: null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      return { docs: DOCS, activeId: "tab-1", split: 50 };
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

/** Name shown on the currently selected tab. */
function activeTabName(): string | null {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]');
  return selected?.textContent?.trim() ?? null;
}

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

describe("Ctrl+Tab tab cycling", () => {
  it("moves to the next tab and wraps around", async () => {
    await renderApp();
    expect(activeTabName()).toContain("one");

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => expect(activeTabName()).toContain("two"));

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => expect(activeTabName()).toContain("three"));

    // Past the last tab it returns to the first.
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => expect(activeTabName()).toContain("one"));
  });

  it("moves to the previous tab with Shift and wraps around", async () => {
    await renderApp();
    expect(activeTabName()).toContain("one");

    // Backwards from the first tab lands on the last one.
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(activeTabName()).toContain("three"));

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(activeTabName()).toContain("two"));
  });

  it("ignores a bare Tab, which still belongs to focus navigation", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "Tab" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(activeTabName()).toContain("one");
  });
});
