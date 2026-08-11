// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSplitDivider } from "./useSplitDivider";

/** Create a PointerEvent with currentTarget set to a mock div element. */
function createEvent(type: string, overrides: Partial<PointerEventInit> = {}): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 400,
    clientY: 0,
    isPrimary: true,
    bubbles: true,
    ...overrides,
  });
  const div = document.createElement("div");
  div.setPointerCapture = () => {};
  div.hasPointerCapture = () => false;
  div.releasePointerCapture = () => {};
  Object.defineProperty(event, "currentTarget", { value: div, writable: false });
  return event;
}

describe("useSplitDivider", () => {
  it("returns initial split value (default 50)", () => {
    const { result } = renderHook(() => useSplitDivider());
    expect(result.current.split).toBe(50);
    expect(result.current.dragging).toBe(false);
  });

  it("returns initial split value (custom)", () => {
    const { result } = renderHook(() => useSplitDivider(30));
    expect(result.current.split).toBe(30);
  });

  it("setSplit updates the split value", () => {
    const { result } = renderHook(() => useSplitDivider());
    act(() => {
      result.current.setSplit(65);
    });
    expect(result.current.split).toBe(65);
  });

  it("splitRatioRef is initialised to initialSplit", () => {
    const { result } = renderHook(() => useSplitDivider(42));
    expect(result.current.splitRatioRef.current).toBe(42);
  });

  it("onDividerDown sets dragging to true", () => {
    const { result } = renderHook(() => useSplitDivider());

    act(() => {
      result.current.onDividerDown(
        createEvent("pointerdown") as unknown as React.PointerEvent<HTMLDivElement>,
      );
    });
    expect(result.current.dragging).toBe(true);
  });

  it("onDividerUp sets dragging to false", () => {
    const { result } = renderHook(() => useSplitDivider());

    act(() => {
      result.current.onDividerDown(
        createEvent("pointerdown") as unknown as React.PointerEvent<HTMLDivElement>,
      );
    });
    expect(result.current.dragging).toBe(true);

    act(() => {
      result.current.onDividerUp(
        createEvent("pointerup") as unknown as React.PointerEvent<HTMLDivElement>,
      );
    });
    expect(result.current.dragging).toBe(false);
  });

  it("onDividerMove does nothing when not dragging", () => {
    const { result } = renderHook(() => useSplitDivider());
    const before = result.current.split;

    act(() => {
      result.current.onDividerMove(
        createEvent("pointermove", { clientX: 999 }) as unknown as React.PointerEvent<HTMLDivElement>,
      );
    });
    expect(result.current.split).toBe(before);
  });

  it("splitRef is a ref object", () => {
    const { result } = renderHook(() => useSplitDivider());
    expect(result.current.splitRef).toBeDefined();
    expect(result.current.splitRef.current).toBeNull();
  });

  it("setSplit allows unclamped values (for session restore)", () => {
    const { result } = renderHook(() => useSplitDivider());

    act(() => {
      result.current.setSplit(5);
    });
    expect(result.current.split).toBe(5);

    act(() => {
      result.current.setSplit(95);
    });
    expect(result.current.split).toBe(95);
  });
});
