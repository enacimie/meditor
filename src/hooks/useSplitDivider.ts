import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type SplitDividerAPI = {
  /** Current split percentage (20-80). */
  split: number;
  /** State setter for the split percentage (used to restore from session). */
  setSplit: React.Dispatch<React.SetStateAction<number>>;
  /** Whether the user is currently dragging the divider. */
  dragging: boolean;
  /** Ref to attach to the split container for measurements. */
  splitRef: React.RefObject<HTMLDivElement | null>;
  /** Current split ratio persisted in a ref (survives re-renders). */
  splitRatioRef: React.MutableRefObject<number>;
  /** onPointerDown handler for the divider element. */
  onDividerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** onPointerMove handler for the divider element. */
  onDividerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** onPointerUp handler for the divider element. */
  onDividerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
};

/**
 * Manages the resizable split divider between editor and preview panes.
 *
 * Provides pointer-event handlers and state for dragging the divider
 * between 20% and 80% of the available space.
 */
export function useSplitDivider(initialSplit = 50): SplitDividerAPI {
  const [split, setSplit] = useState(initialSplit);
  const [dragging, setDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const splitRatioRef = useRef(initialSplit);
  const draggingRef = useRef(false);

  function onDividerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDividerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vertical = window.matchMedia("(max-width: 760px)").matches;
    const size = vertical ? rect.height : rect.width;
    if (size === 0) return;
    const offset = vertical ? e.clientY - rect.top : e.clientX - rect.left;
    const pct = Math.max(20, Math.min(80, (offset / size) * 100));
    splitRatioRef.current = pct;
    setSplit(pct);
  }

  function onDividerUp(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    splitRatioRef.current = Math.max(20, Math.min(80, splitRatioRef.current));
  }

  return {
    split,
    setSplit,
    dragging,
    splitRef,
    splitRatioRef,
    onDividerDown,
    onDividerMove,
    onDividerUp,
  };
}
