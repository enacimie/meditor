// @vitest-environment jsdom
/**
 * Unit tests for presenting a deck, around one thing: the View Transitions
 * callback does not run when it is handed over. It runs at the next rendering
 * opportunity, and everything here is about what may happen in between.
 *
 * jsdom has no `startViewTransition` at all, so the component takes its
 * synchronous fallback and neither bug can appear. Each test that needs the
 * real shape of the API installs a stub that queues the callback the way a
 * browser defers it, and flushes it by hand.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import PresentOverlay from "./PresentOverlay";
import type { TranslationFn } from "../i18n/translations";

const t = ((key: string) => key) as unknown as TranslationFn;

/** Three slides, no fragments, so an arrow key moves the deck rather than revealing. */
const THREE = "---\nmarp: true\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n";
const TWO = "---\nmarp: true\n---\n\n# Only\n\n---\n\n# Other\n";

/*
 * jsdom ships no View Transitions, so this property is ours to install and to
 * take away again. Typed loosely on purpose: lib.dom's own `ViewTransition`
 * carries members a stub has no reason to fake.
 */
const vtDoc = document as unknown as {
  startViewTransition?: (cb: () => void) => unknown;
};

/** A `startViewTransition` that behaves like a browser's: the callback waits. */
function deferTransitions() {
  const queue: (() => void)[] = [];
  vtDoc.startViewTransition = (cb: () => void) => {
    queue.push(cb);
    return { ready: Promise.resolve(), finished: Promise.resolve() };
  };
  return {
    // Wrapped in `act` so that a version of the component which updates React
    // state from inside the callback is judged on what it renders, not on a
    // state update that arrived outside a test's knowledge. Otherwise these
    // tests would fail against such a version for the wrong reason.
    flush: () => act(() => queue.splice(0).forEach((cb) => cb())),
    waiting: () => queue.length,
  };
}

const press = (key: string) => fireEvent.keyDown(window, { key });
const activeIndex = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("svg[data-marpit-svg]")).findIndex((s) =>
    s.classList.contains("present-active"),
  );
const counter = (root: HTMLElement) => root.querySelector(".present-counter")?.textContent?.trim();

afterEach(() => {
  cleanup();
  delete vtDoc.startViewTransition;
  document.documentElement.style.removeProperty("--present-vt-old");
  document.documentElement.style.removeProperty("--present-vt-new");
  document.documentElement.style.removeProperty("--present-vt-duration");
  vi.restoreAllMocks();
});

describe("PresentOverlay", () => {
  it("shows the first slide with the deck's length", () => {
    const { container } = render(<PresentOverlay content={THREE} t={t} onExit={() => {}} />);
    expect(activeIndex(container)).toBe(0);
    expect(counter(container)).toBe("1 / 3");
  });

  it("advances two slides for two presses inside one frame", () => {
    /*
     * A held arrow key repeats every ~30ms against a 0.45s transition, so this
     * is the ordinary case, not a stress test. While the navigation state was
     * written inside the deferred callback, the second press still read the
     * first slide and recomputed the same destination: two presses, one slide.
     */
    const vt = deferTransitions();
    const { container } = render(<PresentOverlay content={THREE} t={t} onExit={() => {}} />);

    press("ArrowRight");
    press("ArrowRight");
    expect(vt.waiting()).toBe(2);
    vt.flush();

    expect(counter(container)).toBe("3 / 3");
    expect(activeIndex(container)).toBe(2);
  });

  it("keeps a slide on screen when the deck changes mid-transition", () => {
    /*
     * Ctrl+Tab is not disabled while presenting, so another document can
     * arrive between handing the callback over and it running. It was written
     * against the old deck: activating slide 3 of a deck that now has two left
     * nothing marked active, and only the active slide is displayed — a black
     * screen, with the counter reading past the end.
     */
    const vt = deferTransitions();
    const { container, rerender } = render(
      <PresentOverlay content={THREE} t={t} onExit={() => {}} />,
    );

    press("ArrowRight");
    press("ArrowRight");
    expect(vt.waiting()).toBe(2);

    rerender(<PresentOverlay content={TWO} t={t} onExit={() => {}} />);
    vt.flush();

    expect(container.querySelectorAll("svg[data-marpit-svg]")).toHaveLength(2);
    expect(activeIndex(container)).toBe(0);
    expect(counter(container)).toBe("1 / 2");
  });

  it("takes its transition variables off the page when it closes", () => {
    // They live on <html> so the ::view-transition pseudo-elements can see
    // them; left behind, they animate the editor on the way out.
    const vt = deferTransitions();
    const { unmount } = render(<PresentOverlay content={THREE} t={t} onExit={() => {}} />);

    press("ArrowRight");
    vt.flush();
    expect(document.documentElement.style.getPropertyValue("--present-vt-old")).not.toBe("");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--present-vt-old")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--present-vt-duration")).toBe("");
  });

  it("goes nowhere past either end of the deck", () => {
    const vt = deferTransitions();
    const { container } = render(<PresentOverlay content={THREE} t={t} onExit={() => {}} />);

    press("ArrowLeft");
    vt.flush();
    expect(counter(container)).toBe("1 / 3");

    press("End");
    vt.flush();
    expect(counter(container)).toBe("3 / 3");

    press("ArrowRight");
    vt.flush();
    expect(counter(container)).toBe("3 / 3");
    expect(activeIndex(container)).toBe(2);
  });
});
