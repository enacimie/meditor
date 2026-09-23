// @vitest-environment jsdom
/**
 * The web build: with no Tauri runtime at all, the app must restore its
 * localStorage session, edit, and route Ctrl+S through the browser backend
 * (no live handle → Save As → download), persisting the session afterwards.
 * Export to PDF goes through the same backend: the browser's print dialog for
 * a Markdown document, a download for the PDF a WASM engine compiled.
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

// The real engine is a WASM module jsdom cannot run. What is under test is the
// route its bytes take in a browser, not the compiler.
vi.mock("./typstEngine", () => ({
  getTypst: async () => ({
    $typst: { pdf: async () => new TextEncoder().encode("%PDF-1.7\n%stand-in\n") },
  }),
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

  it("exports a Markdown document through the browser's print dialog", async () => {
    // jsdom has window.print but does not implement it; the web backend's
    // exportPdf is exactly that call, so it is what gets counted.
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    // The menu entry, as a reader without a keyboard reaches it.
    fireEvent.click(document.querySelector(".menu-toggle")!);
    const entry = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("Export PDF"),
    );
    expect(entry).toBeTruthy();
    fireEvent.click(entry!);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    // And the shortcut, which reaches the same function by another road.
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
  });

  it("downloads the PDF the Typst engine compiled", async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        version: 3,
        activeId: "t1",
        split: 50,
        docs: [
          {
            id: "t1",
            name: "paper.typ",
            path: "paper.typ",
            content: "= Hello",
            dirty: false,
            kind: "typst",
          },
        ],
      }),
    );
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(
      () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
      { timeout: 8000 },
    );

    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));

    // A download named after the document, carrying a PDF.
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("paper.pdf");
    const blob = vi.mocked(window.URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
  });
});
