// @vitest-environment jsdom
/**
 * External-change watch: the app must notice when an open file is rewritten
 * behind its back, reload clean documents silently, and raise the three-way
 * conflict dialog for dirty ones (reload / keep mine / save as).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: { modifiedMs: 1000, size: 10 },
  disk: "v2",
  dirty: false,
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

function sessionDoc() {
  return {
    id: "doc-1",
    name: "notes.md",
    path: "/tmp/notes.md",
    content: h.dirty ? "my edit" : "v1",
    dirty: h.dirty,
    handle: "h-1",
    kind: "markdown",
  };
}

function resetInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "platform":
        return "linux";
      case "cli_files":
        return [];
      case "load_session":
        return { docs: [sessionDoc()], activeId: "doc-1", split: 50 };
      case "document_stat":
        return h.stat;
      case "read_document":
        return h.disk;
      case "save_as":
        return {
          id: "doc-new",
          name: "notes.md",
          path: "/tmp/other.md",
          content: args?.content,
          dirty: false,
          handle: "h-2",
          kind: "markdown",
        };
      default:
        return null;
    }
  });
}

// One poll interval. act() around the clock advance makes React commit the
// state updates the fired callbacks produce before assertions run.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function tick() {
  await advance(3100);
}

async function clickDialogButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    // Run out the dialog's exit transition; the parent unmounts it after.
    await vi.advanceTimersByTimeAsync(300);
  });
}

/**
 * Fake timers go in BEFORE the render: the watch interval must be created
 * against the fake clock, or advancing it would never fire the callbacks.
 * The editor loads through a lazy import, so mounting is waited out with
 * bounded clock advances rather than wall-clock waitFor.
 */
async function mountApp() {
  vi.useFakeTimers();
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  for (let i = 0; i < 200 && !document.querySelector(".cm-editor"); i += 1) {
    await advance(50);
  }
  expect(document.querySelector(".cm-editor")).toBeTruthy();
  // First poll adopts the initial fingerprint, settling the baseline.
  await tick();
}

function editorText(): string {
  return document.querySelector(".cm-content")?.textContent ?? "";
}

function conflictDialog(): HTMLElement | null {
  return document.querySelector(".conflict-overlay");
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
  localStorage.clear();
  h.stat = { modifiedMs: 1000, size: 10 };
  // The disk matches the open buffer until a test simulates an external edit.
  h.disk = "v1";
  h.dirty = false;
  resetInvoke();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("external file changes", () => {
  it("reloads a clean document silently when the file changes on disk", async () => {
    await mountApp();
    expect(editorText()).toContain("v1");

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "v2";
    await tick();

    expect(editorText()).toContain("v2");
    expect(conflictDialog()).toBeNull();
    expect(document.querySelector(".tab.active .tab-dirty")).toBeNull();
  });

  it("raises the conflict dialog for a dirty document and reloads on demand", async () => {
    h.dirty = true;
    h.disk = "my edit";
    await mountApp();

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "their edit";
    await tick();

    const dialog = conflictDialog();
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("notes.md");

    vi.mocked(h.invoke).mockClear();
    await clickDialogButton("Reload from disk");

    expect(editorText()).toContain("their edit");
    expect(conflictDialog()).toBeNull();
    expect(document.querySelector(".tab.active .tab-dirty")).toBeNull();
    // Reloading must not write to disk.
    expect(h.invoke).not.toHaveBeenCalledWith("save_document", expect.anything());
  });

  it("keeps the buffer on 'keep mine', then routes 'save as…' through the dialog", async () => {
    h.dirty = true;
    h.disk = "my edit";
    await mountApp();

    h.stat = { modifiedMs: 2000, size: 12 };
    h.disk = "their edit";
    await tick();
    expect(conflictDialog()).toBeTruthy();

    await clickDialogButton("Keep mine");
    expect(conflictDialog()).toBeNull();
    expect(editorText()).toContain("my edit");
    expect(document.querySelector(".tab.active .tab-dirty")).toBeTruthy();

    // A second external change re-raises the dialog; this time save the
    // buffer elsewhere instead of picking a side.
    h.stat = { modifiedMs: 3000, size: 15 };
    h.disk = "their edit 2";
    await tick();
    expect(conflictDialog()).toBeTruthy();

    vi.mocked(h.invoke).mockClear();
    await clickDialogButton("Save as…");

    const saveAsCall = h.invoke.mock.calls.find(([cmd]) => cmd === "save_as");
    expect(saveAsCall).toBeDefined();
    expect(saveAsCall?.[1]?.content).toBe("my edit");
    expect(conflictDialog()).toBeNull();
  });
});
