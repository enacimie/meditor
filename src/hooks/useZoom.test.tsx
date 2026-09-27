// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { useZoom } from "./useZoom";
import { backend } from "../backend";

const setZoomMock = backend.setZoom as unknown as ReturnType<typeof vi.fn>;

vi.mock("../backend", () => ({
  backend: {
    setZoom: vi.fn(async () => {}),
  },
}));

/** Dispatch a real wheel event so preventDefault is observable. Inside act,
 * because the step it lands ends in a React state update. */
function wheel(deltaY: number, init: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaY,
    cancelable: true,
    ctrlKey: true,
    ...init,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  localStorage.clear();
  setZoomMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("useZoom", () => {
  it("starts at natural size and leaves the backend alone", () => {
    const { result } = renderHook(() => useZoom());
    expect(result.current.zoom).toBe(1);
    expect(setZoomMock).not.toHaveBeenCalled();
  });

  it("restores the remembered zoom on mount, glass included", () => {
    localStorage.setItem("meditor.zoom.v1", "1.5");
    const { result } = renderHook(() => useZoom());
    expect(result.current.zoom).toBe(1.5);
    expect(setZoomMock).toHaveBeenCalledWith(1.5);
  });

  it("walks the ladder and remembers every step", () => {
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(1.1);
    expect(setZoomMock).toHaveBeenLastCalledWith(1.1);
    expect(localStorage.getItem("meditor.zoom.v1")).toBe("1.1");

    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(1.25);

    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(1.1);

    act(() => result.current.zoomReset());
    expect(result.current.zoom).toBe(1);
    expect(setZoomMock).toHaveBeenLastCalledWith(1);
  });

  it("holds at the ends of the ladder without touching the backend", () => {
    localStorage.setItem("meditor.zoom.v1", "3");
    const { result } = renderHook(() => useZoom());
    setZoomMock.mockClear(); // the restore call is not what is being tested
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(3);
    expect(setZoomMock).not.toHaveBeenCalled();
  });

  describe("Ctrl+wheel", () => {
    it("zooms in on a notch up and out on a notch down", () => {
      const { result } = renderHook(() => useZoom());
      wheel(-120);
      expect(result.current.zoom).toBe(1.1);
      wheel(120);
      expect(result.current.zoom).toBe(1);
      wheel(120);
      expect(result.current.zoom).toBe(0.9);
    });

    it("takes the event so the webview's own zoom cannot answer too", () => {
      renderHook(() => useZoom());
      const event = wheel(-120);
      expect(event.defaultPrevented).toBe(true);
    });

    it("ignores a wheel nobody held Ctrl on", () => {
      const { result } = renderHook(() => useZoom());
      const event = wheel(-120, { ctrlKey: false });
      expect(event.defaultPrevented).toBe(false);
      expect(result.current.zoom).toBe(1);
    });

    it("adds small trackpad deltas up to a step", () => {
      const { result } = renderHook(() => useZoom());
      wheel(-30);
      wheel(-30);
      expect(result.current.zoom).toBe(1); // 60 px is not a notch yet
      wheel(-30);
      wheel(-30); // 120 px travelled
      expect(result.current.zoom).toBe(1.1);
    });

    it("starts over when the gesture turns around", () => {
      const { result } = renderHook(() => useZoom());
      wheel(-90); // almost a step in
      wheel(50); // the turn clears the travel in
      wheel(50); // two 50s out are a whole step, and it steps out
      expect(result.current.zoom).toBe(0.9);
    });

    it("counts lines as the pixels a line of text occupies", () => {
      const { result } = renderHook(() => useZoom());
      // Firefox reports a notch as three lines; three lines are a step.
      wheel(-3, { deltaMode: 1 });
      expect(result.current.zoom).toBe(1.1);
    });
  });

  it("swallows a backend that cannot zoom, and keeps the level", () => {
    setZoomMock.mockRejectedValueOnce(new Error("nope"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(1.1);
    expect(localStorage.getItem("meditor.zoom.v1")).toBe("1.1");
    errorSpy.mockRestore();
  });
});
