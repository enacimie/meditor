// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import AboutDialog from "./AboutDialog";
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

function renderDialog(onClose = vi.fn()) {
  const result = render(<AboutDialog t={t} onClose={onClose} />);
  return { onClose, unmount: result.unmount };
}

/** Run the dialog past its exit animation (EXIT_MS = 140). */
function flushExit() {
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("AboutDialog", () => {
  it("renders the brand, version, license and source link", () => {
    renderDialog();
    expect(screen.getByText("meditor")).toBeTruthy();
    expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    expect(screen.getByText("GNU Affero General Public License v3.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source code" })).toBeTruthy();
  });

  it("exposes the dialog to assistive tech", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("About meditor");
  });

  it("focuses the close button on mount", () => {
    renderDialog();
    expect(document.activeElement?.classList.contains("about-close")).toBe(true);
  });

  it("closes on Escape after the exit animation", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking the overlay backdrop", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("dialog"));
    flushExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the panel", () => {
    const { onClose } = renderDialog();
    fireEvent.click(document.querySelector(".about-panel")!);
    flushExit();
    expect(onClose).not.toHaveBeenCalled();
  });
});
