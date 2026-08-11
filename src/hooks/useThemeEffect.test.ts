// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThemeEffect } from "./useThemeEffect";
import type { Theme } from "../components/types";

describe("useThemeEffect", () => {
  let metaTag: HTMLMetaElement;

  beforeEach(() => {
    // Always start with a clean root
    const root = document.documentElement;
    delete root.dataset.theme;
    root.style.colorScheme = "";

    // Create meta theme-color tag if missing
    metaTag = document.querySelector('meta[name="theme-color"]')!;
    if (!metaTag) {
      metaTag = document.createElement("meta");
      metaTag.name = "theme-color";
      document.head.appendChild(metaTag);
    }
    metaTag.setAttribute("content", "");

    // useThemeEffect always calls matchMedia (unconditionally at top of effect)
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── light ──
  it("applies light theme", () => {
    renderHook(() => useThemeEffect("light"));
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#0969da");
  });

  // ── dark ──
  it("applies dark theme", () => {
    renderHook(() => useThemeEffect("dark"));
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#1e1e1e");
  });

  // ── contrast ──
  it("applies contrast theme", () => {
    renderHook(() => useThemeEffect("contrast"));
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("contrast");
    // contrast forces colorScheme to "light" (not "contrast")
    expect(root.style.colorScheme).toBe("light");
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#1e1e1e");
  });

  // ── system (light match) ──
  it("applies system theme when prefers-color-scheme is light", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, // light
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);

    renderHook(() => useThemeEffect("system"));
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("system");
    expect(root.style.colorScheme).toBe("light dark");
    // light → blue accent theme-color
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#0969da");
  });

  // ── system (dark match) ──
  it("applies system theme when prefers-color-scheme is dark", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, // dark
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);

    renderHook(() => useThemeEffect("system"));
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("system");
    expect(root.style.colorScheme).toBe("light dark");
    // dark → #1e1e1e theme-color
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#1e1e1e");
  });

  // ── system listener registration ──
  it("registers change listener for system theme", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();

    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);

    const { unmount } = renderHook(() => useThemeEffect("system"));
    expect(addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  // ── no listener for explicit theme ──
  it("does NOT register listener for explicit (non-system) theme", () => {
    const addEventListener = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener: vi.fn(),
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);

    renderHook(() => useThemeEffect("dark"));
    expect(addEventListener).not.toHaveBeenCalled();
  });

  // ── switching themes ──
  it("re-applies when theme changes", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);

    const { rerender } = renderHook(
      ({ theme }: { theme: Theme }) => useThemeEffect(theme),
      { initialProps: { theme: "light" as Theme } },
    );

    expect(document.documentElement.dataset.theme).toBe("light");

    rerender({ theme: "dark" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
