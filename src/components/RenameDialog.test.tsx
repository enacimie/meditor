// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import RenameDialog from "./RenameDialog";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof RenameDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <RenameDialog
      title="Rename tab"
      label="Document name"
      initialValue="Doc 1"
      confirmLabel="Rename"
      cancelLabel="Cancel"
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

describe("RenameDialog", () => {
  it("renders the current name in the input", () => {
    renderDialog();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Doc 1");
  });

  it("focuses and selects the input on mount", () => {
    renderDialog();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBe(document.activeElement);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it("restores focus to the element that opened the dialog on close", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const { onCancel, unmount } = renderDialog();
    // Focus is moved into the dialog while it is open.
    expect(screen.getByRole("textbox")).toBe(document.activeElement);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Unmounting (what App does after onCancel resolves) restores focus.
    unmount();
    expect(button).toBe(document.activeElement);
    button.remove();
  });

  it("confirms with the trimmed value on Enter after the exit animation", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  New name  " },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // The callback is deferred until the exit transition has played.
    expect(onConfirm).not.toHaveBeenCalled();
    flushExit();
    expect(onConfirm).toHaveBeenCalledWith("New name");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape after the exit animation", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables confirm when the name is empty or whitespace-only", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    expect(confirm.disabled).toBe(false);
  });

  it("does not confirm when Enter is pressed with an empty name", () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    flushExit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirm button submits the trimmed value after the exit animation", () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    flushExit();
    expect(onConfirm).toHaveBeenCalledWith("Renamed");
  });

  it("cancel button cancels after the exit animation", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("applies the closing class during the exit transition", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    const overlay = screen.getByRole("dialog");
    expect(overlay.classList.contains("closing")).toBe(true);
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Enter on the Cancel button does not confirm (overlay never hijacks Enter)", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New" },
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    // Keydown alone must not trigger a confirm (Enter is handled only by the
    // input; the browser's default action on the button is a click).
    fireEvent.keyDown(cancel, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    // The button's default action (click) cancels.
    fireEvent.click(cancel);
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking the overlay backdrop cancels", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(document.querySelector(".rename-overlay")!);
    flushExit();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the dialog does not cancel", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(document.querySelector(".rename-dialog")!);
    flushExit();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("is announced as a modal dialog with the title", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("rename-title");
  });
});
