// @vitest-environment jsdom
/**
 * The front-matter's author, subject and keywords reach `export_pdf`.
 *
 * No engine writes them into its PDF (measured in #189), so the desktop
 * backend adds them afterwards (`pdf_meta.rs`), from what this sends. The
 * reading of the front-matter has tests of its own; this is about the export
 * handing it over, for a document and for a deck.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** The body of the one open document, front-matter and all. */
  content: "# Notes\n",
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

// The deck's size is all the Marp export reads from a render; the real engine
// is slow to load and draws on a canvas jsdom does not have.
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
      default:
        return null;
    }
  });
}

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

/** Ctrl+E, and answer with the metadata `export_pdf` was given. */
async function metadataExported(): Promise<unknown> {
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });
  return waitFor(
    () => {
      const call = h.invoke.mock.calls.find(([cmd]) => cmd === "export_pdf");
      if (!call) throw new Error("nothing was exported");
      return (call[1] as { meta?: unknown }).meta;
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
  h.invoke.mockClear();
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the metadata an exported PDF is given", () => {
  it("is the front-matter's author, subject and keywords", async () => {
    h.content =
      "---\ntitle: Informe\nauthor: [Ana Pérez, Luis Gómez]\nsubject: Medición\nkeywords: [pdf, marcadores]\n---\n\n# Uno\n";
    await mountApp();
    expect(await metadataExported()).toEqual({
      author: "Ana Pérez; Luis Gómez",
      subject: "Medición",
      keywords: "pdf, marcadores",
    });
  });

  it("is a deck's too", async () => {
    h.content = "---\nmarp: true\nauthor: Ana\n---\n\n# Una\n";
    await mountApp();
    expect(await metadataExported()).toEqual({ author: "Ana" });
  });

  it("is nothing when the front-matter names none of it", async () => {
    await mountApp();
    expect(await metadataExported()).toEqual({});
  });
});
