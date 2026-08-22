// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ConflictDialog from "./ConflictDialog";

const props = () => ({
  title: "File changed on disk",
  message: '"notes.md" was changed by another program.',
  reloadLabel: "Reload from disk",
  keepLabel: "Keep mine",
  saveAsLabel: "Save as…",
  onReload: vi.fn(),
  onKeep: vi.fn(),
  onSaveAs: vi.fn(),
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConflictDialog", () => {
  it("renders title and message", () => {
    render(<ConflictDialog {...props()} />);
    expect(screen.getByText("File changed on disk")).toBeTruthy();
    expect(screen.getByText(/notes\.md/)).toBeTruthy();
  });

  it("fires each action from its own fresh mount", async () => {
    vi.useFakeTimers();

    // Fresh mount per action: the real parent unmounts the dialog once the
    // callback fires, and a closed dialog must not be clickable again.
    const p1 = props();
    render(<ConflictDialog {...p1} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
    await vi.advanceTimersByTimeAsync(200);
    expect(p1.onReload).toHaveBeenCalledTimes(1);
    cleanup();

    const p2 = props();
    render(<ConflictDialog {...p2} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await vi.advanceTimersByTimeAsync(200);
    expect(p2.onKeep).toHaveBeenCalledTimes(1);
    cleanup();

    const p3 = props();
    render(<ConflictDialog {...p3} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as…" }));
    await vi.advanceTimersByTimeAsync(200);
    expect(p3.onSaveAs).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("routes Escape to the non-destructive keep action", async () => {
    const p = props();
    vi.useFakeTimers();
    render(<ConflictDialog {...p} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await vi.advanceTimersByTimeAsync(200);
    expect(p.onKeep).toHaveBeenCalledTimes(1);
    expect(p.onReload).not.toHaveBeenCalled();
    expect(p.onSaveAs).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("focuses Keep mine on mount (non-destructive default)", () => {
    render(<ConflictDialog {...props()} />);
    expect(document.activeElement?.textContent).toBe("Keep mine");
  });
});
