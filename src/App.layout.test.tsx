// @vitest-environment jsdom
/**
 * Workspace layout modes: editor only, split, preview only.
 *
 * The panes are hidden with CSS, which jsdom does not apply, so these tests
 * assert on the class the app puts on its root and on the behaviour that
 * depends on the mode. Whether a pane is actually invisible is covered by
 * tests/e2e/layout-modes.spec.mjs in a real browser.
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
            id: "layout-1",
            name: "Doc",
            path: null,
            content: "# hello",
            dirty: false,
            handle: null,
          },
        ],
        activeId: "layout-1",
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

function app(): HTMLElement {
  return document.querySelector(".app") as HTMLElement;
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

describe("layout modes", () => {
  it("starts in split, which carries no class of its own", async () => {
    await renderApp();
    expect(app().className).not.toContain("layout-");
  });

  it("switches with Ctrl+1, Ctrl+2 and Ctrl+3", async () => {
    await renderApp();

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-editor")).toBe(true));
    expect(app().classList.contains("layout-preview")).toBe(false);

    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));
    expect(app().classList.contains("layout-editor")).toBe(false);

    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    await waitFor(() => expect(app().className).not.toContain("layout-"));
  });

  it("ignores AltGr, which arrives as Ctrl+Alt on Spanish keyboards", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "1", ctrlKey: true, altKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app().className).not.toContain("layout-");
  });

  it("remembers the mode across sessions", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem("meditor.preferences.v1") ?? "{}",
      );
      expect(stored.layoutMode).toBe("preview");
    });
  });

  it("hides the go-to-preview button outside split", async () => {
    await renderApp();
    const label = "Go to cursor position in preview";
    expect(document.querySelector(`[aria-label="${label}"]`)).toBeTruthy();

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() =>
      expect(document.querySelector(`[aria-label="${label}"]`)).toBeNull(),
    );
  });

  it("does not focus the hidden editor with Ctrl+K in preview mode", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector(".cm-search")).toBeNull();
  });

  /*
   * Pane sizing is written inline by App.tsx, not left to the stylesheet: the
   * divider ratio while both panes share the workspace, the whole workspace
   * otherwise. Doing it from CSS meant overriding an inline value, which the
   * Windows and macOS CI runners did not resolve reliably — the editor kept
   * half the width with dead space beside it. jsdom computes no layout, so
   * assert on the declared value, and let the E2E spec measure real widths.
   */
  it("gives the whole workspace to the visible pane outside split view", async () => {
    await renderApp();
    const panes = () => [...document.querySelectorAll<HTMLElement>(".split > .pane")];
    expect(panes()).toHaveLength(2);
    for (const pane of panes()) expect(pane.style.flex).toMatch(/^0 0 \d+%$/);

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-editor")).toBe(true));
    for (const pane of panes()) expect(pane.style.flex).toBe("1 1 100%");

    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));
    for (const pane of panes()) expect(pane.style.flex).toBe("1 1 100%");

    // Back to split, the ratio returns.
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    await waitFor(() => {
      for (const pane of panes()) expect(pane.style.flex).toMatch(/^0 0 \d+%$/);
    });
  });

  it("gives zen mode the whole workspace too, which had the same clash", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(app().classList.contains("zen")).toBe(true));
    for (const pane of document.querySelectorAll<HTMLElement>(".split > .pane")) {
      expect(pane.style.flex).toBe("1 1 100%");
    }
  });

  it("keeps the chosen mode while zen mode takes over", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));

    // Zen wins visually (CSS), but the choice must survive it.
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(app().classList.contains("zen")).toBe(true));
    expect(app().classList.contains("layout-preview")).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(app().classList.contains("zen")).toBe(false));
    expect(app().classList.contains("layout-preview")).toBe(true);
  });
});

describe("layout switch control", () => {
  it("is a radio group with the current mode checked", async () => {
    await renderApp();
    const group = document.querySelector('[role="radiogroup"]');
    expect(group).toBeTruthy();
    const radios = group!.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(3);
    // Split is the default: the middle option is the checked one.
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].getAttribute("aria-checked")).toBe("false");
  });

  it("switches mode when a radio is clicked", async () => {
    await renderApp();
    const radios = document.querySelectorAll('[role="radio"]');
    fireEvent.click(radios[2]);
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
  });

  it("moves through the modes with the arrow keys", async () => {
    await renderApp();
    const group = document.querySelector('[role="radiogroup"]') as HTMLElement;

    // From split (middle), one step right lands on preview-only.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));

    // And wraps around back to editor-only.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    await waitFor(() => expect(app().classList.contains("layout-editor")).toBe(true));

    fireEvent.keyDown(group, { key: "ArrowLeft" });
    await waitFor(() => expect(app().classList.contains("layout-preview")).toBe(true));
  });

  it("keeps a single tab stop for the whole group", async () => {
    await renderApp();
    const radios = [...document.querySelectorAll('[role="radio"]')];
    const tabbable = radios.filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("aria-checked")).toBe("true");
  });
});
