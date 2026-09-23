// @vitest-environment jsdom
/**
 * Ctrl+F inside the editor, on macOS.
 *
 * There CodeMirror finds with Cmd+F and reads Ctrl+F as "caret right", the
 * Emacs-style binding macOS text fields share. It picks its platform from
 * navigator.platform when its module loads, so this file claims to be a Mac
 * before anything imports it. Every other App test runs on jsdom's empty
 * platform, where Mod is Ctrl.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") {
      return {
        docs: [
          {
            id: "mac-1",
            name: "Doc",
            path: null,
            content: "# hello",
            dirty: false,
            handle: null,
          },
        ],
        activeId: "mac-1",
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

describe("Ctrl+F in the editor on macOS", () => {
  it("moves the caret, even where it cannot, and Cmd+F still finds", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy(), {
      timeout: 8000,
    });
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    content.focus();
    const head = () => view.state.selection.main.head;

    view.dispatch({ selection: { anchor: 0 } });
    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    // If this file were not running as a Mac, Ctrl+F would be CodeMirror's
    // own find and the panel would be open here.
    expect(head()).toBe(1);
    expect(document.querySelector(".cm-search")).toBeNull();

    // At the end of the text "caret right" has nowhere to go and CodeMirror
    // lets the key through. It is still the editor's key, not a find.
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end } });
    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    expect(head()).toBe(end);
    expect(document.querySelector(".cm-search")).toBeNull();

    fireEvent.keyDown(content, { key: "f", metaKey: true });
    await waitFor(() => expect(document.querySelector(".cm-search")).toBeTruthy());
  });
});
