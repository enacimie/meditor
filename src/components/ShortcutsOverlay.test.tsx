// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { translations } from "../i18n/translations";
import type { TranslationFn } from "../i18n/translations";

/** Real English translations so assertions read naturally. */
const t = ((key: string, ...args: unknown[]) => {
  const value = (translations.en as Record<string, unknown>)[key];
  return typeof value === "function"
    ? (value as (...a: unknown[]) => string)(...args)
    : String(value);
}) as TranslationFn;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderOverlay(onClose = vi.fn()) {
  const result = render(<ShortcutsOverlay t={t} onClose={onClose} />);
  return { onClose, unmount: result.unmount };
}

/** Run the overlay past its exit animation (EXIT_MS = 140). */
function flushExit() {
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("ShortcutsOverlay", () => {
  it("renders the dialog with the shortcut list", () => {
    renderOverlay();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("F2")).toBeTruthy();
    expect(screen.getByText("F11")).toBeTruthy();
  });

  it("lists Ctrl+K with the focus-search description", () => {
    renderOverlay();
    const rows = Array.from(document.querySelectorAll(".shortcuts-row"));
    const ctrlK = rows.find((row) => row.textContent?.includes("Ctrl+K"));
    expect(ctrlK).toBeTruthy();
    expect(ctrlK?.textContent).toContain("Focus search field");
  });

  it("exposes the dialog to assistive tech", () => {
    renderOverlay();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Keyboard shortcuts");
  });

  it("focuses the close button on mount", () => {
    renderOverlay();
    expect(document.activeElement?.classList.contains("shortcuts-close")).toBe(true);
  });

  it("restores focus to the element that opened the overlay on close", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const { onClose, unmount } = renderOverlay();
    // Focus is moved into the overlay while it is open.
    expect(document.activeElement?.classList.contains("shortcuts-close")).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
    // Unmounting (what App does after onClose) restores focus.
    unmount();
    expect(button).toBe(document.activeElement);
    button.remove();
  });

  it("closes after the exit animation when the close button is clicked", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(document.querySelector(".shortcuts-close")!);
    // The callback is deferred until the exit transition has played.
    expect(onClose).not.toHaveBeenCalled();
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies the closing class during the exit transition", () => {
    renderOverlay();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("closing")).toBe(true);
    flushExit();
  });

  it("closes on Escape after the exit animation", () => {
    const { onClose } = renderOverlay();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking the overlay backdrop", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(screen.getByRole("dialog"));
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the panel", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(document.querySelector(".shortcuts-panel")!);
    flushExit();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab inside the overlay", () => {
    renderOverlay();
    const close = document.querySelector<HTMLButtonElement>(".shortcuts-close")!;
    // There is a single focusable element — Tab from it wraps to itself.
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(close).toBe(document.activeElement);
  });

  it("ignores further close requests once closing has started", () => {
    const { onClose } = renderOverlay();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    // A second interaction during the exit animation must not double-fire.
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog);
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
