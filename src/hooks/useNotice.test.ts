// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotice } from "./useNotice";

/**
 * Who is allowed to take a notice down.
 *
 * There is one line for all of it, and two things put a message there with no
 * timer — a failed autosave and an update download — so "clear the notice"
 * without saying whose is an instruction that can hit the wrong one. This is
 * that rule, on its own, because it is easier to state here than to arrange
 * through the application.
 */
describe("the notice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes away on its own after the duration", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showNotice("saved", "success"));
    expect(result.current.notice?.message).toBe("saved");
    act(() => void vi.advanceTimersByTime(3600));
    expect(result.current.notice).toBeNull();
  });

  it("stays when the duration is zero", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showNotice("downloading", "info", 0));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current.notice?.message).toBe("downloading");
  });

  it("is taken down by the one that put it up", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showNotice("could not save", "error", 0, "autosave"));
    act(() => result.current.dismissNotice("autosave"));
    expect(result.current.notice).toBeNull();
  });

  it("is not taken down by somebody else", () => {
    /*
     * The reachable case: a failed autosave leaves a message with no timer,
     * the writer starts an update, and the download's own message replaces
     * it. The next autosave that works then asked for the notice to go — and
     * took the download's with it, leaving a download running and nothing on
     * screen to say so.
     */
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showNotice("downloading", "info", 0, "update"));
    act(() => result.current.dismissNotice("autosave"));
    expect(result.current.notice?.message).toBe("downloading");
  });

  it("can still be cleared outright by a caller that names nobody", () => {
    // For a caller that has decided nothing at all should be on screen.
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showNotice("downloading", "info", 0, "update"));
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it("hands ownership to whatever replaces it", () => {
    /*
     * A notice is replaced far more often than it is dismissed, and the one
     * that arrives owns the line from then on. Without this the previous
     * owner could still clear a message that is no longer theirs — the same
     * defect as above, a moment later.
     */
    const { result } = renderHook(() => useNotice());
    act(() => result.current.showNotice("could not save", "error", 0, "autosave"));
    // Most notices name nobody — they have a timer and nothing clears them by
    // hand. One of those replacing an owned message still takes the line.
    act(() => result.current.showNotice("2 files opened", "success"));
    act(() => result.current.dismissNotice("autosave"));
    expect(result.current.notice?.message).toBe("2 files opened");
  });
});
