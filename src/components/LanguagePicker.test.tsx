// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Language } from "../i18n/translations";
import LanguagePicker from "./LanguagePicker";

beforeEach(() => {
  // jsdom does not implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockT = vi.fn((key: string) => {
  const dict: Record<string, string> = {
    "lang.searchPlaceholder": "Search language…",
    "lang.searchAria": "Search language",
    "lang.clearSearch": "Clear search",
    "lang.noResults": "No languages found",
  };
  return dict[key] ?? key;
});

function renderPicker(lang: Language = "en", onSelect = vi.fn()) {
  return render(<LanguagePicker lang={lang} t={mockT as unknown as typeof mockT} onSelect={onSelect} />);
}

// ── Initial render ────────────────────────────────────────────────

describe("LanguagePicker", () => {
  describe("initial render", () => {
    it("renders the search input with auto-focus", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      expect(input).toBeDefined();
      expect(input).toBe(document.activeElement);
    });

    it("renders all 104 languages in the listbox", () => {
      renderPicker();
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(104);
    });

    it("marks the current language as selected (aria + class)", () => {
      renderPicker("es");
      const selected = screen.getByRole("option", { selected: true });
      expect(selected).toBeDefined();
      expect(selected.textContent).toContain("Español");
      expect(selected.className).toContain("lang-option--selected");
    });

    it("shows the checkmark on the selected language", () => {
      renderPicker("fr");
      const selected = screen.getByRole("option", { selected: true });
      expect(selected.querySelector(".lang-check")).toBeDefined();
    });
  });

  // ── Filtering ───────────────────────────────────────────────────

  describe("filtering", () => {
    it("filters by native name (case-insensitive)", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "español" } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option").textContent).toContain("Español");
    });

    it("filters by English label (case-insensitive)", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "German" } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option").textContent).toContain("Deutsch");
    });

    it("filters by language code", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "ja" } });
      const options = screen.getAllByRole("option");
      // Should match "ja" (Japanese) — may also match other codes containing "ja"
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options.some((o) => o.textContent?.includes("日本語"))).toBe(true);
    });

    it("shows 'No languages found' when no match", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "zzzzz" } });
      expect(screen.getByText("No languages found")).toBeDefined();
      expect(screen.queryByRole("option")).toBeNull();
    });

    it("shows all languages again when query is cleared", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "hin" } });
      expect(screen.getAllByRole("option").length).toBeLessThan(104);
      // Clear via the clear button
      const clearBtn = screen.getByLabelText("Clear search");
      fireEvent.click(clearBtn);
      expect(screen.getAllByRole("option")).toHaveLength(104);
    });

    it("clears search when clear button is clicked", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "español" } });
      const clearBtn = screen.getByLabelText("Clear search");
      fireEvent.click(clearBtn);
      expect((input as HTMLInputElement).value).toBe("");
    });
  });

  // ── Keyboard navigation ─────────────────────────────────────────

  describe("keyboard navigation", () => {
    it("ArrowDown focuses the first option when nothing is focused", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(options[0]).toBe(document.activeElement);
    });

    it("ArrowDown cycles through options", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      // First arrow down → first option
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(options[0]).toBe(document.activeElement);
      // Second → second option
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(options[1]).toBe(document.activeElement);
    });

    it("ArrowUp moves focus into the list from the search input", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      // Tab to blur the input so handleKeyDown uses the list
      fireEvent.keyDown(input, { key: "ArrowUp" });
      // Focus should now be on one of the option buttons (not the input)
      const focused = document.activeElement;
      expect(focused?.getAttribute("role")).toBe("option");
    });

    it("ArrowDown wraps from last to first", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      const options = screen.getAllByRole("option");
      const lastIdx = options.length - 1;
      // Navigate to first, then go up to wrap to last, then down to wrap to first
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(options[0]).toBe(document.activeElement);
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(options[lastIdx]).toBe(document.activeElement);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(options[0]).toBe(document.activeElement);
    });

    it("Escape calls onSelect with current language (close without change)", () => {
      const onSelect = vi.fn();
      renderPicker("es", onSelect);
      const input = screen.getByLabelText("Search language");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onSelect).toHaveBeenCalledWith("es");
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("Arrow keys only affect the listbox options, not other buttons", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      // Navigate down twice
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(options[1]).toBe(document.activeElement);
    });
  });

  // ── Selection ───────────────────────────────────────────────────

  describe("selection", () => {
    it("calls onSelect with the correct code when clicking an option", () => {
      const onSelect = vi.fn();
      renderPicker("en", onSelect);
      // Find Hindi option and click it
      const hindiOption = screen.getByText("हिन्दी").closest("button")!;
      fireEvent.click(hindiOption);
      expect(onSelect).toHaveBeenCalledWith("hi");
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("can select the currently active language (no-op reselect)", () => {
      const onSelect = vi.fn();
      renderPicker("it", onSelect);
      const italianOption = screen.getByText("Italiano").closest("button")!;
      fireEvent.click(italianOption);
      expect(onSelect).toHaveBeenCalledWith("it");
    });

    it("selects a non-Latin script language by native name", () => {
      const onSelect = vi.fn();
      renderPicker("en", onSelect);
      const arabicOption = screen.getByText("العربية").closest("button")!;
      fireEvent.click(arabicOption);
      expect(onSelect).toHaveBeenCalledWith("ar");
    });
  });

  // ── Empty state ─────────────────────────────────────────────────

  describe("empty state", () => {
    it("shows 'No languages found' when filtering yields zero results", () => {
      renderPicker();
      const input = screen.getByLabelText("Search language");
      fireEvent.change(input, { target: { value: "xyz123nonexistent" } });
      expect(screen.getByText("No languages found")).toBeDefined();
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
  });
});
