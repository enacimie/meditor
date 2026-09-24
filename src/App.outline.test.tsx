// @vitest-environment jsdom
/**
 * The outline lists the headings of the open document, read in its own
 * language: a Markdown document's `#` headings and not the `#` comments in
 * its code, a Typst document's `=` headings. The parser is tested on its own
 * (outlineUtils.test.ts); this is the application handing it the kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  content: "# Notes\n",
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

vi.mock("./Preview", () => ({ default: () => <div data-testid="preview-mock" /> }));
vi.mock("./TypstPreview", () => ({ default: () => <div data-testid="typst-preview-mock" /> }));

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
  h.invoke.mockReset();
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
              name: h.kind === "typst" ? "notes.typ" : "notes.md",
              path: h.kind === "typst" ? "/tmp/notes.typ" : "/tmp/notes.md",
              content: h.content,
              dirty: false,
              handle: "h-1",
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

/** Open the document, open the outline, and read what it lists. */
async function outlineOf(firstLine: string): Promise<string[]> {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  await waitFor(() => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content?.textContent?.includes(firstLine)) throw new Error("document not open yet");
  });
  fireEvent.click(document.querySelector('[aria-controls="document-outline"]')!);
  return waitFor(() => {
    const items = [...document.querySelectorAll("#document-outline .outline-text")];
    if (!items.length) throw new Error("outline not listed yet");
    return items.map((item) => item.textContent ?? "");
  });
}

describe("the outline", () => {
  it("lists a Markdown document's headings and not the comments in its code", async () => {
    h.kind = "markdown";
    h.content = "# Install\n\n```bash\n# the package manager\npnpm install\n```\n\n## Run\n";
    expect(await outlineOf("Install")).toEqual(["Install", "Run"]);
  });

  it("lists a Typst document's headings, written with =", async () => {
    h.kind = "typst";
    h.content = "= Introduction\n\n== Details\n";
    expect(await outlineOf("Introduction")).toEqual(["Introduction", "Details"]);
  });
});
