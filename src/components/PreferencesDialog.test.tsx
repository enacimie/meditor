// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import PreferencesDialog from "./PreferencesDialog";
import {
  EDITOR_FONT_FAMILIES,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_SPELLCHECK,
  clampFontSize,
  fontStackFor,
  normalizeFontFamily,
  normalizeSpellcheck,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
} from "../editorPreferences";
import { translations } from "../i18n/translations";

const t = ((key: string, ...args: unknown[]) => {
  const value = (translations.en as Record<string, unknown>)[key];
  if (typeof value === "function") return (value as (...a: unknown[]) => string)(...args);
  return (value as string) ?? key;
}) as never;

const value = {
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
  spellcheck: DEFAULT_SPELLCHECK,
};

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

describe("PreferencesDialog", () => {
  it("is a modal dialog and focuses its close button", async () => {
    render(<PreferencesDialog t={t} value={value} onChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    await waitFor(() =>
      expect(document.activeElement?.classList.contains("prefs-close")).toBe(true),
    );
  });

  it("reports the font size the user picks", () => {
    const onChange = vi.fn();
    render(<PreferencesDialog t={t} value={value} onChange={onChange} onClose={vi.fn()} />);
    const slider = document.querySelector<HTMLInputElement>("#prefs-font-size")!;
    expect(slider.min).toBe(String(MIN_EDITOR_FONT_SIZE));
    expect(slider.max).toBe(String(MAX_EDITOR_FONT_SIZE));
    fireEvent.change(slider, { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, editorFontSize: 18 });
  });

  it("reports the font family the user picks", () => {
    const onChange = vi.fn();
    render(<PreferencesDialog t={t} value={value} onChange={onChange} onClose={vi.fn()} />);
    const select = document.querySelector<HTMLSelectElement>("#prefs-font-family")!;
    fireEvent.change(select, { target: { value: "serif" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, editorFontFamily: "serif" });
  });

  it("previews the current choice", () => {
    render(
      <PreferencesDialog
        t={t}
        value={{ editorFontSize: 20, editorFontFamily: "serif", spellcheck: true }}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const preview = document.querySelector<HTMLElement>(".prefs-preview")!;
    expect(preview.style.fontSize).toBe("20px");
    expect(preview.style.fontFamily).toContain("Georgia");
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    render(<PreferencesDialog t={t} value={value} onChange={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps Tab inside the dialog", () => {
    render(<PreferencesDialog t={t} value={value} onChange={vi.fn()} onClose={vi.fn()} />);
    const panel = document.querySelector(".prefs-panel")!;
    const focusables = [...panel.querySelectorAll<HTMLElement>("button, input, select")];
    expect(focusables.length).toBeGreaterThan(2);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Tab on the last control wraps to the first.
    last.focus();
    fireEvent.keyDown(document.querySelector(".prefs-overlay")!, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab on the first wraps to the last.
    first.focus();
    fireEvent.keyDown(document.querySelector(".prefs-overlay")!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps Tab inside the dialog", () => {
    // The focus trap is the most intricate part of the component and had no
    // coverage at all.
    render(<PreferencesDialog t={t} value={value} onChange={vi.fn()} onClose={vi.fn()} />);
    const panel = document.querySelector(".prefs-panel")!;
    const overlay = document.querySelector(".prefs-overlay")!;
    const focusables = [...panel.querySelectorAll<HTMLElement>("button, input, select")];
    expect(focusables.length).toBeGreaterThan(2);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Tab on the last control wraps round to the first.
    last.focus();
    fireEvent.keyDown(overlay, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab on the first wraps round to the last.
    first.focus();
    fireEvent.keyDown(overlay, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes when clicking the backdrop but not the panel", async () => {
    const onClose = vi.fn();
    render(<PreferencesDialog t={t} value={value} onChange={vi.fn()} onClose={onClose} />);
    fireEvent.click(document.querySelector(".prefs-panel")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".prefs-overlay")!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("editorPreferences", () => {
  it("clamps stored font sizes into the offered range", () => {
    expect(clampFontSize(16)).toBe(16);
    expect(clampFontSize(2)).toBe(MIN_EDITOR_FONT_SIZE);
    expect(clampFontSize(999)).toBe(MAX_EDITOR_FONT_SIZE);
    expect(clampFontSize(14.6)).toBe(15);
    // Anything that is not a usable number falls back to the default.
    expect(clampFontSize("18")).toBe(DEFAULT_EDITOR_FONT_SIZE);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_EDITOR_FONT_SIZE);
    expect(clampFontSize(undefined)).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });

  it("reads the stored spell check flag defensively", () => {
    expect(normalizeSpellcheck(false)).toBe(false);
    expect(normalizeSpellcheck(true)).toBe(true);
    expect(normalizeSpellcheck("yes")).toBe(DEFAULT_SPELLCHECK);
    expect(normalizeSpellcheck(undefined)).toBe(DEFAULT_SPELLCHECK);
  });

  it("only accepts font families that are still offered", () => {
    expect(normalizeFontFamily("serif")).toBe("serif");
    expect(normalizeFontFamily("comic-sans")).toBe(DEFAULT_EDITOR_FONT_FAMILY);
    expect(normalizeFontFamily(42)).toBe(DEFAULT_EDITOR_FONT_FAMILY);
  });

  it("resolves a font stack for every offered family", () => {
    for (const font of EDITOR_FONT_FAMILIES) {
      expect(fontStackFor(font.id)).toBe(font.stack);
    }
  });

  it("falls back to the first family for anything unknown", () => {
    // Compared against the actual stack, not just "monospace": that word
    // appears in five of the six stacks, so matching it proved nothing.
    expect(fontStackFor("nonexistent")).toBe(EDITOR_FONT_FAMILIES[0].stack);
    expect(fontStackFor("")).toBe(EDITOR_FONT_FAMILIES[0].stack);
  });
});
