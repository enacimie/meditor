// @vitest-environment jsdom
/**
 * Unit tests for the application close guard (the once-registered
 * `onCloseRequested` handler in App.tsx).
 *
 * Verifies the guarantees that fixed the "double-click to close" bug:
 *  1. The FIRST close request actually closes: session is saved, then the
 *     app exits (nothing swallows the first click).
 *  2. Cancelling the unsaved-changes dialog keeps the window open (no exit).
 *  3. The session is ALWAYS saved before exiting (ordering guarantee).
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

// Hoisted state shared by the Tauri mocks and the tests themselves.
const { closeHandlerRef, invokeMock, registerCountRef } = vi.hoisted(() => ({
  closeHandlerRef: {
    current: null as null | ((e: { preventDefault: () => void }) => Promise<void>),
  },
  invokeMock: vi.fn(),
  registerCountRef: { count: 0 },
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (
      handler: (e: { preventDefault: () => void }) => Promise<void>,
    ) => {
      registerCountRef.count += 1;
      closeHandlerRef.current = handler;
      return Promise.resolve(() => {});
    },
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

// Keep the preview panel out of this test (markdown/mermaid rendering).
vi.mock("./Preview", () => ({
  default: () => <div data-testid="preview-mock" />,
}));

function sessionDoc(dirty: boolean) {
  return {
    docs: [
      {
        id: "close-1",
        name: "Close",
        path: null,
        content: "# close guard",
        dirty,
        handle: null,
      },
    ],
    activeId: "close-1",
    split: 50,
  };
}

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
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") return null;
    return null;
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Renders App with a restored session and waits for the editor to mount.
 * Optionally renders under StrictMode (dev double-mount) to pin the
 * "registered exactly once" guarantee of the close guard.
 */
async function renderAppWithSession(
  dirty: boolean,
  options: { strictMode?: boolean } = {},
) {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "cli_files") return [];
    if (cmd === "load_session") return sessionDoc(dirty);
    return null;
  });
  const app = (
    <I18nProvider>
      <App />
    </I18nProvider>
  );
  render(options.strictMode ? <StrictMode>{app}</StrictMode> : app);
  await waitFor(
    () => expect(document.querySelector(".cm-editor")).toBeTruthy(),
    { timeout: 8000 },
  );
  // Drop the restore-time invokes so assertions only see the close flow.
  invokeMock.mockClear();
}

function closeEvent() {
  return { preventDefault: vi.fn() };
}

function closeCalls(): string[] {
  return invokeMock.mock.calls.map((call) => call[0] as string);
}

describe("application close guard", () => {
  it("closes on the first close request: saves the session then exits exactly once", async () => {
    await renderAppWithSession(false);

    const event = closeEvent();
    await act(async () => {
      await closeHandlerRef.current!(event);
    });

    // The OS close was intercepted (so the app runs its cleanup)…
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    const calls = closeCalls();
    // …and the first click actually exits (nothing swallowed it)…
    expect(calls.filter((c) => c === "exit_app")).toHaveLength(1);
    // …but only after the session was persisted.
    const exitIndex = calls.indexOf("exit_app");
    expect(calls.slice(0, exitIndex)).toContain("save_session");

    // The session payload captured before exiting is the restored document.
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === "save_session");
    expect(saveCall?.[1]).toMatchObject({
      input: { activeId: "close-1", docs: expect.any(Array) },
    });
  });

  it("keeps the window open when the user cancels the unsaved-changes dialog", async () => {
    await renderAppWithSession(true);

    const event = closeEvent();
    let pending!: Promise<void>;
    act(() => {
      pending = closeHandlerRef.current!(event);
    });

    // The in-window ConfirmDialog must appear (no native dialog), and the
    // OS close is intercepted while it is shown.
    await waitFor(() =>
      expect(document.querySelector('[role="alertdialog"]')).toBeTruthy(),
    );
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    // Click "No" (the first .confirm-btn is the cancel button).
    fireEvent.click(document.querySelector(".confirm-btn")!);

    await act(async () => {
      await pending;
    });

    // Cancel must NOT exit — the window stays open — and the dialog closes.
    expect(closeCalls().includes("exit_app")).toBe(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("registers the close guard exactly once under StrictMode (no duplicate listeners)", async () => {
    registerCountRef.count = 0;
    await renderAppWithSession(false, { strictMode: true });

    // StrictMode's dev double-mount must NOT leave two onCloseRequested
    // listeners (duplicates used to swallow the first close request).
    expect(registerCountRef.count).toBe(1);
    expect(closeHandlerRef.current).not.toBeNull();

    // …and the single registered guard still performs the full close flow.
    const event = closeEvent();
    await act(async () => {
      await closeHandlerRef.current!(event);
    });
    const calls = closeCalls();
    expect(calls.filter((c) => c === "exit_app")).toHaveLength(1);
    expect(calls.slice(0, calls.indexOf("exit_app"))).toContain("save_session");
  });

  it("confirming the unsaved-changes dialog saves the session before exiting", async () => {
    await renderAppWithSession(true);

    const event = closeEvent();
    let pending!: Promise<void>;
    act(() => {
      pending = closeHandlerRef.current!(event);
    });

    await waitFor(() =>
      expect(document.querySelector(".confirm-btn--primary")).toBeTruthy(),
    );
    // Click "Yes" (confirm).
    fireEvent.click(document.querySelector(".confirm-btn--primary")!);

    await act(async () => {
      await pending;
    });

    const calls = closeCalls();
    expect(calls.filter((c) => c === "exit_app")).toHaveLength(1);
    const exitIndex = calls.indexOf("exit_app");
    expect(calls.slice(0, exitIndex)).toContain("save_session");
  });
});
