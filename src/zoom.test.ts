// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  ZOOM_LEVELS,
  DEFAULT_ZOOM,
  normalizeZoom,
  stepZoom,
  loadZoom,
  saveZoom,
} from "./zoom";

beforeEach(() => {
  localStorage.clear();
});

describe("normalizeZoom", () => {
  it("returns the default for anything that is not a finite number", () => {
    expect(normalizeZoom(undefined)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(null)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom("1.5")).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(NaN)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(Infinity)).toBe(DEFAULT_ZOOM);
  });

  it("snaps a stray value to the nearest level on the ladder", () => {
    expect(normalizeZoom(1.04)).toBe(1);
    expect(normalizeZoom(1.06)).toBe(1.1);
    expect(normalizeZoom(1.3)).toBe(1.25);
  });

  it("clamps to the ends of the ladder", () => {
    expect(normalizeZoom(0.01)).toBe(ZOOM_LEVELS[0]);
    expect(normalizeZoom(-2)).toBe(ZOOM_LEVELS[0]);
    expect(normalizeZoom(99)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  });

  it("leaves a level alone", () => {
    for (const level of ZOOM_LEVELS) {
      expect(normalizeZoom(level)).toBe(level);
    }
  });
});

describe("stepZoom", () => {
  it("walks the ladder in both directions", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1.25, -1)).toBe(1.1);
  });

  it("holds at the ends", () => {
    const top = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    expect(stepZoom(top, 1)).toBe(top);
    expect(stepZoom(ZOOM_LEVELS[0], -1)).toBe(ZOOM_LEVELS[0]);
  });

  it("steps from a stray value as if it were the nearest level", () => {
    expect(stepZoom(1.04, 1)).toBe(1.1);
    expect(stepZoom(1.04, -1)).toBe(0.9);
  });
});

describe("the remembered zoom", () => {
  it("is the default when nothing was saved", () => {
    expect(loadZoom()).toBe(DEFAULT_ZOOM);
  });

  it("round-trips through storage", () => {
    saveZoom(1.5);
    expect(loadZoom()).toBe(1.5);
  });

  it("falls back to the default for a stored value that is not a level", () => {
    localStorage.setItem("meditor.zoom.v1", "not a number");
    expect(loadZoom()).toBe(DEFAULT_ZOOM);
    localStorage.setItem("meditor.zoom.v1", "42");
    expect(loadZoom()).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  });

  it("survives storage that throws", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("denied");
    };
    try {
      expect(loadZoom()).toBe(DEFAULT_ZOOM);
    } finally {
      window.localStorage.getItem = original;
    }
  });
});
