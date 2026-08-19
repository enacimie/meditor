// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider, useTranslation } from "../i18n/I18nProvider";
import type { Language } from "../i18n/translations";
import Topbar from "./Topbar";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Find the hamburger menu toggle — language-independent (uses aria-haspopup). */
function getMenuToggle(): HTMLElement {
  return screen.getByRole("button", { name: /more options|más opciones|plus d'options|अधिक|خيارات|weitere|その他|더 보기|altro/i });
}

/** Renders Topbar inside I18nProvider with call-counting spy on setLanguage / setTheme. */
function renderTopbar(overrides: {
  lang?: Language;
  onSetLanguageSpy?: ReturnType<typeof vi.fn>;
  onSetThemeSpy?: ReturnType<typeof vi.fn>;
  onNewTypstSpy?: ReturnType<typeof vi.fn>;
  onNewLatexSpy?: ReturnType<typeof vi.fn>;
} = {}) {
  const langSpy = (overrides.onSetLanguageSpy ?? vi.fn()) as (code: Language) => void;
  const themeSpy = (overrides.onSetThemeSpy ?? vi.fn()) as (t: string) => void;
  const newTypstSpy = overrides.onNewTypstSpy ?? vi.fn();
  const newLatexSpy = overrides.onNewLatexSpy ?? vi.fn();

  function Inner() {
    const { t, lang, setLanguage } = useTranslation();
    const [menuOpen, setMenuOpen] = React.useState(false);

    function handleSetLanguage(code: Language) {
      langSpy(code);
      setLanguage(code);
    }

    return (
      <Topbar
        t={t}
        lang={overrides.lang ?? lang}
        setLanguage={handleSetLanguage}
        layoutMode="split"
        onLayoutModeChange={vi.fn()}
        onFind={vi.fn()}
        notice={null}
        busyOperation={null}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        theme="system"
        setTheme={themeSpy}
        zenMode={false}
        onToggleZen={vi.fn()}
        onNew={vi.fn()}
        onNewTypst={newTypstSpy as () => void}
        onNewLatex={newLatexSpy as () => void}
        onOpen={vi.fn()}
        onSave={vi.fn()}
        onSaveAs={vi.fn()}
        onExportPdf={vi.fn()}
        onCloseAll={vi.fn()}
        onCloseOthers={vi.fn()}
        onAbout={vi.fn()}
      />
    );
  }

  // Need React for useState
  const utils = render(
    <I18nProvider>
      <Inner />
    </I18nProvider>,
  );

  return { ...utils, langSpy, themeSpy, newTypstSpy, newLatexSpy };
}

import React from "react";

// ─── Integration tests ────────────────────────────────────────────

describe("Topbar integration", () => {
  it("renders brand and action buttons", () => {
    renderTopbar();
    expect(screen.getByAltText("meditor")).toBeDefined();
    expect(screen.getByLabelText("New tab (Ctrl+N)")).toBeDefined();
    expect(screen.getByLabelText("Open files (Ctrl+O)")).toBeDefined();
    expect(screen.getByLabelText("Save (Ctrl+S)")).toBeDefined();
  });

  it("keeps specialized document creation inside the more-options menu", () => {
    const { newTypstSpy, newLatexSpy } = renderTopbar();

    expect(screen.queryByLabelText("New Typst tab")).toBeNull();
    expect(screen.queryByLabelText("New LaTeX tab")).toBeNull();

    fireEvent.click(getMenuToggle());
    const menu = screen.getByRole("menu");
    const typstItem = screen.getByRole("menuitem", { name: /New \.typ/ });
    const latexItem = screen.getByRole("menuitem", { name: /New \.tex/ });
    expect(menu.contains(typstItem)).toBe(true);
    expect(menu.contains(latexItem)).toBe(true);

    fireEvent.click(typstItem);
    expect(newTypstSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(getMenuToggle());
    fireEvent.click(screen.getByRole("menuitem", { name: /New \.tex/ }));
    expect(newLatexSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the menu when hamburger is clicked", () => {
    renderTopbar();
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(getMenuToggle());
    expect(screen.getByRole("menu")).toBeDefined();
  });

  it("opens language picker, searches, selects Hindi", async () => {
    const { langSpy } = renderTopbar();

    // 1. Open hamburger menu
    fireEvent.click(getMenuToggle());
    expect(screen.getByRole("menu")).toBeDefined();

    // 2. Click collapsed language button — it's inside the menu, shows native name
    const menu = screen.getByRole("menu");
    const langBtn = Array.from(menu.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("English"),
    )!;
    expect(langBtn.getAttribute("aria-expanded")).toBe("false");
    expect(langBtn.getAttribute("aria-controls")).toBe("language-picker");
    fireEvent.click(langBtn);

    // 3. Wait for lazy LanguagePicker to mount (Suspense resolves)
    const searchInput = await screen.findByRole("combobox");
    expect(searchInput).toBeDefined();
    expect(document.getElementById("language-picker")).toBeDefined();

    // 4. Type "hin" to filter
    fireEvent.change(searchInput, { target: { value: "hin" } });
    const filtered = screen.getAllByRole("option");
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.some((o) => o.textContent?.includes("हिन्दी"))).toBe(true);

    // 5. Click Hindi
    fireEvent.click(screen.getByText("हिन्दी").closest("button")!);

    // 6. Verify spy
    expect(langSpy).toHaveBeenCalledWith("hi");

    // 7. Menu should close after selection
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selects Arabic via search by English label", async () => {
    const { langSpy } = renderTopbar();

    fireEvent.click(getMenuToggle());
    fireEvent.click(screen.getByText("English").closest("button")!);

    const input = await screen.findByLabelText("Search language");
    fireEvent.change(input, { target: { value: "arabic" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("العربية");

    fireEvent.click(options[0]);
    expect(langSpy).toHaveBeenCalledWith("ar");
  });

  it("collapses language picker when menu is closed externally", async () => {
    renderTopbar();

    // Open menu → expand picker
    fireEvent.click(getMenuToggle());
    fireEvent.click(screen.getByText("English").closest("button")!);

    await screen.findByLabelText("Search language");

    // Close menu via hamburger click
    fireEvent.click(getMenuToggle());

    // Picker input should vanish
    // Picker input should vanish
    expect(screen.queryByLabelText("Search language")).toBeNull();
    // Collapsed language button should still be visible when menu reopens
    fireEvent.click(getMenuToggle());
    const menuAfter = screen.getByRole("menu");
    expect(menuAfter.textContent).toContain("English");
  });

  // ── Theme picker ────────────────────────────────────────────

  it("theme picker is collapsed by default showing current theme", () => {
    renderTopbar();
    fireEvent.click(getMenuToggle());

    // Only the collapsed theme button ("System") is visible — no radio items
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    const themeBtn = screen.getByText("System").closest("button")!;
    expect(themeBtn).toBeDefined();
    expect(themeBtn.querySelector(".theme-swatch")).toBeDefined();
  });

  it("theme picker expands, exposes stable ARIA controls, and focuses the selected option", () => {
    renderTopbar();
    fireEvent.click(getMenuToggle());

    const themeBtn = screen.getByText("System").closest("button")!;
    expect(themeBtn.getAttribute("aria-expanded")).toBe("false");
    expect(themeBtn.getAttribute("aria-controls")).toBe("theme-options");
    fireEvent.click(themeBtn);

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios).toHaveLength(4);
    expect(document.activeElement).toBe(radios[0]);
    expect(radios[0].textContent).toContain("System");
    expect(radios[1].textContent).toContain("Light");
    expect(radios[2].textContent).toContain("Dark");
    expect(radios[3].textContent).toContain("High contrast");
  });

  it("selecting Light theme calls setTheme and closes menu", () => {
    const { themeSpy } = renderTopbar();
    fireEvent.click(getMenuToggle());
    fireEvent.click(screen.getByText("System").closest("button")!);

    fireEvent.click(screen.getByText("Light"));

    expect(themeSpy).toHaveBeenCalledWith("light");
    expect(themeSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selecting Dark theme calls setTheme and closes menu", () => {
    const { themeSpy } = renderTopbar();
    fireEvent.click(getMenuToggle());
    fireEvent.click(screen.getByText("System").closest("button")!);

    fireEvent.click(screen.getByText("Dark"));

    expect(themeSpy).toHaveBeenCalledWith("dark");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selecting High contrast theme calls setTheme with contrast", () => {
    const { themeSpy } = renderTopbar();
    fireEvent.click(getMenuToggle());
    fireEvent.click(screen.getByText("System").closest("button")!);

    fireEvent.click(screen.getByText("High contrast"));

    expect(themeSpy).toHaveBeenCalledWith("contrast");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("theme picker collapses when menu is closed and reopened", () => {
    renderTopbar();
    fireEvent.click(getMenuToggle());

    // Expand theme picker
    fireEvent.click(screen.getByText("System").closest("button")!);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);

    // Close menu
    fireEvent.click(getMenuToggle());
    expect(screen.queryByRole("menu")).toBeNull();

    // Reopen — theme picker should be collapsed again
    fireEvent.click(getMenuToggle());
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(screen.getByText("System").closest("button")).toBeDefined();
  });
});
