import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import { DEFAULT_ZOOM, loadZoom, saveZoom, stepZoom } from "../zoom";

export type ZoomAPI = {
  /** The window's current scale factor; 1 is natural size. */
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
};

/**
 * Wheel distance that earns one step on the ladder.
 *
 * A mouse notch reports about 100 pixels, so a notch is a step; a trackpad
 * reports a stream of small deltas, which add up to a step when the gesture
 * has travelled as far as a notch would. One threshold serves both because
 * both are measured in the same unit first.
 */
const WHEEL_PIXELS_PER_STEP = 100;

/**
 * The window's zoom: the level, the shortcuts that move it, and the
 * Ctrl+wheel that moves it from anywhere on the page.
 *
 * The level lives here rather than in Preferences because it is a view of the
 * moment — reached for with a shortcut, remembered across sessions, and not
 * something the settings dialog owns.
 */
export function useZoom(): ZoomAPI {
  const [zoom, setZoom] = useState<number>(loadZoom);
  // The wheel listener registers once and still has to step from the level of
  // the moment, so it reads the current value through a ref.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** Wheel travel not yet turned into a step, in normalized pixels. */
  const wheelAccum = useRef(0);

  const applyZoom = useCallback((next: number) => {
    if (next === zoomRef.current) return;
    zoomRef.current = next;
    setZoom(next);
    saveZoom(next);
    backend.setZoom(next).catch((error) => {
      console.error("Could not zoom the window", error);
    });
  }, []);

  const zoomIn = useCallback(() => {
    applyZoom(stepZoom(zoomRef.current, 1));
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    applyZoom(stepZoom(zoomRef.current, -1));
  }, [applyZoom]);

  const zoomReset = useCallback(() => {
    applyZoom(DEFAULT_ZOOM);
  }, [applyZoom]);

  // Put the remembered level back on the glass. The state already started
  // there; this is the one time the backend has to be told without anyone
  // having asked for a change.
  useEffect(() => {
    const saved = loadZoom();
    if (saved === DEFAULT_ZOOM) return;
    backend.setZoom(saved).catch((error) => {
      console.error("Could not restore the window zoom", error);
    });
  }, []);

  // Ctrl+wheel anywhere in the window. Capture and not passive: the webview's
  // own zoom answers the same gesture on some platforms, and the page would
  // move twice — the listener takes the event before it can reach either the
  // browser's default or anything scrolling underneath. A trackpad pinch
  // arrives as exactly this event, ctrlKey held by the system, so pinching
  // zooms too.
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      // Lines and pages, where a device reports them, count as the pixels a
      // line and a page of ordinary text occupy: 40 and 800.
      const unit =
        event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
      // Up means larger, as it does in every program that zooms on a wheel.
      const pixels = -event.deltaY * unit;
      if (pixels === 0) return;
      // A turn in the other direction starts accumulating from zero: the
      // travel left over from zooming in must not shorten the way back.
      if (Math.sign(pixels) !== Math.sign(wheelAccum.current)) {
        wheelAccum.current = 0;
      }
      wheelAccum.current += pixels;
      let steps = Math.trunc(wheelAccum.current / WHEEL_PIXELS_PER_STEP);
      if (steps === 0) return;
      wheelAccum.current -= steps * WHEEL_PIXELS_PER_STEP;
      let next = zoomRef.current;
      while (steps !== 0) {
        next = stepZoom(next, steps > 0 ? 1 : -1);
        steps -= Math.sign(steps);
      }
      applyZoom(next);
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [applyZoom]);

  return { zoom, zoomIn, zoomOut, zoomReset };
}
