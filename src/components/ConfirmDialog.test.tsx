// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const MESSAGE = "There are unsaved documents. Exit anyway?";

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <ConfirmDialog
      title="Confirm"
      message={MESSAGE}
      confirmLabel="Yes"
      cancelLabel="No"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel, unmount: result.unmount };
}

/** Run the dialog past its exit animation (EXIT_MS = 140). */
function flushExit() {
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("ConfirmDialog", () => {
  it("renders title, message and both actions", () => {
    renderDialog();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No" })).toBeTruthy();
  });

  it("exposes the dialog to assistive tech", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("confirm-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("confirm-message");
  });

  it("focuses the safe default (cancel) on mount", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "No" })).toBe(document.activeElement);
  });

  it("restores focus to the element that opened the dialog on close", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const { onCancel, unmount } = renderDialog();
    // Focus is moved into the dialog while it is open.
    expect(screen.getByRole("button", { name: "No" })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Unmounting (what App does after onCancel resolves) restores focus.
    unmount();
    expect(button).toBe(document.activeElement);
    button.remove();
  });

  it("calls onConfirm after the exit animation when the confirm button is clicked", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    // The callback is deferred until the exit transition has played.
    expect(onConfirm).not.toHaveBeenCalled();
    flushExit();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel after the exit animation when the cancel button is clicked", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onCancel).not.toHaveBeenCalled();
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("applies the closing class during the exit transition", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    const overlay = screen.getByRole("alertdialog");
    expect(overlay.classList.contains("closing")).toBe(true);
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape after the exit animation", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels when clicking the overlay backdrop", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("alertdialog"));
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel when clicking inside the dialog", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    flushExit();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // The overlay click handler must not fire for the inner click.
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("traps Tab between the two buttons", () => {
    renderDialog();
    const cancel = screen.getByRole("button", { name: "No" });
    const confirm = screen.getByRole("button", { name: "Yes" });
    // Tab from the last button wraps to the first.
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toBe(document.activeElement);
    // Shift+Tab from the first button wraps to the last.
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toBe(document.activeElement);
  });

  it("ignores further close requests once closing has started", () => {
    const { onCancel } = renderDialog();
    const cancel = screen.getByRole("button", { name: "No" });
    fireEvent.click(cancel);
    // A second interaction during the exit animation must not double-resolve.
    fireEvent.click(cancel);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
