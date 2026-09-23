// @vitest-environment jsdom
/**
 * Export to PDF and printing where the webview cannot print.
 *
 * A Markdown document reaches PDF through the webview's own printing, and so
 * does Ctrl+P. Rust has that on Windows, Linux and the BSDs, and answers "not
 * supported" everywhere else. The menu hid the entry on a phone but not on a
 * Mac, and neither shortcut asked at all: there, Ctrl+E and Ctrl+P went all
 * the way to Rust to be refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  platform: "macos",
  kind: "markdown" as "markdown" | "typst",
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

// The compiler itself is not the subject: a Typst export only has to get as
// far as handing Rust its bytes.
vi.mock("./typstEngine", () => ({
  getTypst: async () => ({
    $typst: { pdf: async () => new TextEncoder().encode("%PDF-1.7\n%stand-in\n") },
  }),
}));

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
  h.platform = "macos";
  h.kind = "markdown";
  h.invoke.mockClear();
  h.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "platform":
        return h.platform;
      case "cli_files":
        return [];
      case "load_session":
        return {
          docs: [
            {
              id: "doc-1",
              name: h.kind === "typst" ? "notes.typ" : "notes.md",
              path: null,
              content: h.kind === "typst" ? "= Notes\n" : "# Notes\n",
              dirty: false,
              handle: null,
              kind: h.kind,
            },
          ],
          activeId: "doc-1",
          split: 50,
        };
      default:
        return null;
    }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

const called = (cmd: string) => h.invoke.mock.calls.some(([name]) => name === cmd);
const notice = () => document.querySelector(".app-notice")?.textContent ?? "";

function menuEntries(): string[] {
  fireEvent.click(document.querySelector(".menu-toggle")!);
  const entries = [...document.querySelectorAll('#app-menu [role="menuitem"]')].map(
    (el) => el.textContent ?? "",
  );
  fireEvent.click(document.querySelector(".menu-toggle")!);
  return entries;
}

/**
 * Until Rust says which platform this is, printing counts as available: a
 * desktop must not flicker its menu entry. So every check waits for the
 * answer, which a refused Ctrl+P makes visible.
 */
async function platformKnownOnAMac() {
  await waitFor(() => {
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(notice()).toBe("Printing is not available on this system");
  });
}

describe("where the webview cannot print", () => {
  it("offers no Export PDF for a Markdown document on a Mac", async () => {
    await mountApp();
    await platformKnownOnAMac();
    expect(menuEntries().some((entry) => entry.includes("Export PDF"))).toBe(false);
  });

  it("keeps Export PDF for a Typst document, which compiles its own", async () => {
    h.kind = "typst";
    await mountApp();
    await platformKnownOnAMac();
    expect(menuEntries().some((entry) => entry.includes("Export PDF"))).toBe(true);
  });

  it("answers Cmd+E on a Markdown document itself, and asks Rust for nothing", async () => {
    await mountApp();
    await platformKnownOnAMac();

    fireEvent.keyDown(window, { key: "e", metaKey: true });
    await waitFor(() =>
      expect(notice()).toBe("Exporting Markdown to PDF is not available on this system"),
    );
    expect(called("export_pdf")).toBe(false);
  });

  it("still exports a Typst document with Cmd+E", async () => {
    h.kind = "typst";
    await mountApp();
    await platformKnownOnAMac();

    fireEvent.keyDown(window, { key: "e", metaKey: true });
    await waitFor(() => expect(called("write_pdf_bytes")).toBe(true));
  });

  it("answers Cmd+P itself, and asks Rust for nothing", async () => {
    await mountApp();
    await platformKnownOnAMac();
    expect(called("print_document")).toBe(false);
  });

  it("does the same on Android", async () => {
    h.platform = "android";
    await mountApp();
    await waitFor(() => {
      fireEvent.keyDown(window, { key: "e", ctrlKey: true });
      expect(notice()).toBe("Exporting Markdown to PDF is not available on this system");
    });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(notice()).toBe("Printing is not available on this system"));
    expect(called("export_pdf")).toBe(false);
    expect(called("print_document")).toBe(false);
  });
});

describe("where it can", () => {
  it("still hands Ctrl+E and Ctrl+P to Rust on Linux", async () => {
    h.platform = "linux";
    await mountApp();
    await waitFor(() => expect(called("platform")).toBe(true));

    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await waitFor(() => expect(called("export_pdf")).toBe(true));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(called("print_document")).toBe(true));
    expect(menuEntries().some((entry) => entry.includes("Export PDF"))).toBe(true);
  });
});
