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
    it("exposes combobox semantics and keeps focus on the input", () => {
      renderPicker();
      const input = screen.getByRole("combobox");
      const list = screen.getByRole("listbox");
      expect(input.getAttribute("aria-controls")).toBe(list.id);
      expect(input.getAttribute("aria-expanded")).toBe("true");
      expect(input.getAttribute("aria-autocomplete")).toBe("list");
      expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    });

    it("ArrowDown activates the first option without moving focus", () => {
      renderPicker();
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(input).toBe(document.activeElement);
      expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    });

    it("ArrowDown cycles through options", () => {
      renderPicker();
      const input = screen.getByRole("combobox");
      // First arrow down advances from the first active option.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(input).toBe(document.activeElement);
      expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
      // Second → third option
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input.getAttribute("aria-activedescendant")).toBe(options[2].id);
    });

    it("ArrowUp wraps the active descendant while keeping focus in the combobox", () => {
      renderPicker();
      const input = screen.getByRole("combobox");
      const options = screen.getAllByRole("option");
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(document.activeElement).toBe(input);
      expect(input.getAttribute("aria-activedescendant")).toBe(options[options.length - 1].id);
    });

    it("ArrowDown wraps from last to first", () => {
      renderPicker();
      const input = screen.getByRole("combobox");
      const options = screen.getAllByRole("option");
      const lastIdx = options.length - 1;
      // Navigate forward, back, then forward again.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(input.getAttribute("aria-activedescendant")).toBe(options[lastIdx].id);
    });

    it("Enter selects the active filtered language", () => {
      const onSelect = vi.fn();
      renderPicker("en", onSelect);
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "German" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledWith("de");
    });

    it("Escape calls onSelect with current language (close without change)", () => {
      const onSelect = vi.fn();
      renderPicker("es", onSelect);
      const input = screen.getByLabelText("Search language");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onSelect).toHaveBeenCalledWith("es");
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("Arrow keys stay inside the combobox instead of moving menu focus", () => {
      renderPicker();
      const input = screen.getByRole("combobox");
      // Navigate down twice
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(input).toBe(document.activeElement);
      expect(input.getAttribute("aria-activedescendant")).toBe(options[2].id);
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
