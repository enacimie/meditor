// @vitest-environment jsdom
/**
 * The exported PDF carries the document's own title.
 *
 * Every engine takes the PDF's title from `document.title` while it prints
 * (measured in #189), and the application keeps that set to the tab's name.
 * So what decides the PDF's title from here is what `document.title` says
 * while `export_pdf` runs — and afterwards the tab's name has to come back,
 * however the export ended.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** The body of the one open document, front-matter and all. */
  content: "# Notes\n",
  /** What `document.title` said when `export_pdf` was called. */
  titleWhilePrinting: null as string | null,
  /** Ends the export that is under way, one way or the other. */
  settle: null as null | ((outcome: "written" | "failed") => void),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: h.invoke,
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

/*
 * The deck's size is all the Marp export reads from a render. The real engine
 * is slow to load and draws on a canvas jsdom does not have: in the full suite
 * the export had not reached the backend a second later.
 */
vi.mock("./marpEngine", () => ({
  renderMarp: () => ({ html: '<svg data-marpit-svg viewBox="0 0 1280 720"></svg>', css: "" }),
}));

function resetInvoke() {
  h.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "platform":
        return "linux";
      case "cli_files":
        return [];
      case "load_session":
        return {
          docs: [
            {
              id: "doc-1",
              name: "notes.md",
              path: "/tmp/notes.md",
              content: h.content,
              dirty: false,
              handle: "h-1",
              kind: "markdown",
            },
          ],
          activeId: "doc-1",
          split: 50,
        };
      case "export_pdf":
        // Held open, the way the real command is while the engine prints.
        h.titleWhilePrinting = document.title;
        return new Promise((resolve, reject) => {
          h.settle = (outcome) =>
            outcome === "written" ? resolve(null) : reject(new Error("the printer failed"));
        });
      default:
        return null;
    }
  });
}

/** Wait for the app to be ready enough that its shortcuts do anything. */
async function mountApp() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  await waitFor(() => {
    if (!document.querySelector(".cm-editor")) throw new Error("no editor yet");
  });
}

/**
 * Ctrl+E, and wait until the export has reached the backend. Longer than the
 * default second: the whole suite runs in parallel, and a busy machine is not
 * a missing export.
 */
async function startExport() {
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });
  await waitFor(
    () => {
      if (!h.settle) throw new Error("nothing is being exported yet");
    },
    { timeout: 5000 },
  );
}

beforeAll(async () => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  // Reached through `React.lazy`; resolved here so no test waits on it.
  await import("./Editor");
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
  h.content = "# Notes\n";
  h.titleWhilePrinting = null;
  h.settle = null;
  h.invoke.mockClear();
  resetInvoke();
});

afterEach(() => {
  // An export a test left open would otherwise hold its title into the next.
  h.settle?.("written");
  cleanup();
  vi.restoreAllMocks();
});

describe("the title of an exported PDF", () => {
  it("is the one the front-matter gives, while the engine prints", async () => {
    h.content = "---\ntitle: Informe de medición\n---\n\n# Uno\n";
    await mountApp();
    expect(document.title).toBe("notes.md");
    await startExport();
    expect(h.titleWhilePrinting).toBe("Informe de medición");
    // Still printing: the title has to hold until the PDF is written.
    expect(document.title).toBe("Informe de medición");
    h.settle?.("written");
    await waitFor(() => expect(document.title).toBe("notes.md"));
  });

  it("stays the tab's name for a document that names no title", async () => {
    await mountApp();
    await startExport();
    expect(h.titleWhilePrinting).toBe("notes.md");
  });

  it("gives the tab its name back when the export fails", async () => {
    h.content = "---\ntitle: Informe\n---\n\n# Uno\n";
    await mountApp();
    await startExport();
    expect(h.titleWhilePrinting).toBe("Informe");
    h.settle?.("failed");
    await waitFor(() => expect(document.title).toBe("notes.md"));
  });

  it("is a Marp deck's own title too", async () => {
    h.content = "---\nmarp: true\ntitle: Charla\n---\n\n# Una\n";
    await mountApp();
    await startExport();
    expect(h.titleWhilePrinting).toBe("Charla");
  });
});
