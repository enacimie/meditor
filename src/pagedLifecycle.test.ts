// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isPaginatable } from "./pagedLifecycle";

/**
 * jsdom does not implement layout, so `offsetParent` is always null there.
 * These tests define it per element to model the three states that matter:
 * on screen, hidden by an ancestor, and detached.
 */
function makeElement({
  attached,
  offsetParent,
}: {
  attached: boolean;
  offsetParent: Element | null;
}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetParent", {
    get: () => offsetParent,
    configurable: true,
  });
  if (attached) document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isPaginatable", () => {
  it("accepts an element that is attached and laid out", () => {
    expect(isPaginatable(makeElement({ attached: true, offsetParent: document.body }))).toBe(true);
  });

  it("rejects an element hidden by an ancestor", () => {
    // What zen mode does: `.app.zen .pane:last-child { display: none }`.
    // The node stays in the document but has no offsetParent, which is exactly
    // what paged.js dereferences.
    expect(isPaginatable(makeElement({ attached: true, offsetParent: null }))).toBe(false);
  });

  it("rejects a detached element", () => {
    // What switching a tab to Typst/LaTeX does: React unmounts the container.
    expect(isPaginatable(makeElement({ attached: false, offsetParent: null }))).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isPaginatable(null)).toBe(false);
    expect(isPaginatable(undefined)).toBe(false);
  });
});
