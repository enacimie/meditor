// @vitest-environment jsdom
/**
 * The language a document says it is written in, and where it has to arrive.
 *
 * `lang` in the front-matter, which is Pandoc's key. What matters is that it
 * reaches the two places the text is shown: the preview, which puts it on
 * the page, and the editor, whose content element is what the platform's
 * spell checker reads. Checked on the props the preview is given and on the
 * editor's own element.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import type { DocumentLanguage } from "./documentLanguage";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** The body of the one open document, front-matter and all. */
  content: "# Notes\n",
  kind: "markdown" as "markdown" | "typst",
  /** Every `language` the preview has been rendered with, in order. */
  languages: [] as Array<DocumentLanguage | null | undefined>,
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
  default: (props: { language?: DocumentLanguage | null }) => {
    h.languages.push(props.language);
    return <div data-testid="preview-mock" />;
  },
}));

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
  h.kind = "markdown";
  h.languages = [];
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

/** Open the document, and wait until the editor is showing it. */
async function openDocument(firstLine: string) {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  return waitFor(() => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content?.textContent?.includes(firstLine)) throw new Error("document not open yet");
    return content;
  });
}

/** The language the preview was last rendered with. */
const previewLanguage = () => h.languages[h.languages.length - 1];

describe("the language a document declares", () => {
  it("reaches the preview and the editor", async () => {
    h.content = "---\nlang: es\n---\n\n# Notas\n";
    const content = await openDocument("Notas");
    expect(previewLanguage()).toEqual({ tag: "es", dir: "ltr" });
    expect(content.getAttribute("lang")).toBe("es");
  });

  it("brings its direction with it", async () => {
    h.content = "---\nlang: ar\n---\n\n# ملاحظات\n";
    const content = await openDocument("ملاحظات");
    expect(previewLanguage()).toEqual({ tag: "ar", dir: "rtl" });
    // The editor takes the language and not the direction: see Editor.tsx.
    expect(content.getAttribute("lang")).toBe("ar");
    expect(content.hasAttribute("dir")).toBe(false);
  });

  it("is none when the document says nothing, so the interface's applies", async () => {
    const content = await openDocument("Notes");
    expect(previewLanguage()).toBeNull();
    expect(content.hasAttribute("lang")).toBe(false);
  });

  it("is none when what it says is not a language", async () => {
    h.content = "---\nlang: inglés\n---\n\n# Notes\n";
    const content = await openDocument("Notes");
    expect(previewLanguage()).toBeNull();
    expect(content.hasAttribute("lang")).toBe(false);
  });

  it("is read from Markdown's front-matter only", async () => {
    // Typst says it with `#set text(lang: ...)`; a block that looks like YAML
    // at the top of a Typst file is not a declaration.
    h.kind = "typst";
    h.content = "---\nlang: es\n---\n\n= Notas\n";
    const content = await openDocument("Notas");
    expect(previewLanguage()).toBeNull();
    expect(content.hasAttribute("lang")).toBe(false);
  });
});
