// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { I18nProvider, useTranslation } from "./I18nProvider";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Minimal consumer that renders the current lang + a static translation */
function TestConsumer() {
  const { lang, setLanguage, t } = useTranslation();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="new-label">{t("topbar.new")}</span>
      <span data-testid="loading-label">{t("app.loading")}</span>
      <span data-testid="files-opened">{t("op.filesOpened", 3)}</span>
      <button data-testid="switch-es" onClick={() => setLanguage("es")}>
        Switch to ES
      </button>
      <button data-testid="switch-en" onClick={() => setLanguage("en")}>
        Switch to EN
      </button>
      <button data-testid="switch-fr" onClick={() => setLanguage("fr")}>
        Switch to FR
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <I18nProvider>
      <TestConsumer />
    </I18nProvider>,
  );
}

function setLocalStorage(lang: string) {
  window.localStorage.setItem("meditor.language.v1", lang);
}

function clearLocalStorage() {
  window.localStorage.removeItem("meditor.language.v1");
}

describe("I18nProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "en";
  });

  // ── Language switching ──────────────────────────────────────────

  it("renders English by default when no localStorage is set", () => {
    renderProvider();
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("new-label").textContent).toBe("New");
    expect(screen.getByTestId("loading-label").textContent).toBe("Loading...");
  });

  it("switches to Spanish and translates strings correctly", () => {
    renderProvider();
    act(() => {
      screen.getByTestId("switch-es").click();
    });
    expect(screen.getByTestId("lang").textContent).toBe("es");
    expect(screen.getByTestId("new-label").textContent).toBe("Nuevo");
    expect(screen.getByTestId("loading-label").textContent).toBe("Cargando...");
  });

  it("switches back to English from Spanish", () => {
    renderProvider();
    act(() => screen.getByTestId("switch-es").click());
    expect(screen.getByTestId("lang").textContent).toBe("es");
    act(() => screen.getByTestId("switch-en").click());
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("new-label").textContent).toBe("New");
  });

  it("updates document.documentElement.lang on language change", () => {
    renderProvider();
    expect(document.documentElement.lang).toBe("en");
    act(() => screen.getByTestId("switch-es").click());
    expect(document.documentElement.lang).toBe("es");
  });

  // ── Function translations ───────────────────────────────────────

  it("handles function-style translation keys with arguments", () => {
    renderProvider();
    // op.filesOpened is (n: number) => `${n} file(s) opened`
    expect(screen.getByTestId("files-opened").textContent).toBe("3 files opened");

    act(() => screen.getByTestId("switch-es").click());
    expect(screen.getByTestId("files-opened").textContent).toBe("3 archivos abiertos");
  });

  // ── localStorage persistence ────────────────────────────────────

  it("reads language from localStorage on mount", () => {
    setLocalStorage("es");
    renderProvider();
    expect(screen.getByTestId("lang").textContent).toBe("es");
    expect(screen.getByTestId("new-label").textContent).toBe("Nuevo");
  });

  it("writes language to localStorage on change", () => {
    renderProvider();
    act(() => screen.getByTestId("switch-es").click());
    expect(window.localStorage.getItem("meditor.language.v1")).toBe("es");
  });

  it("writes language to localStorage when switching back to English", () => {
    setLocalStorage("es");
    renderProvider();
    act(() => screen.getByTestId("switch-en").click());
    expect(window.localStorage.getItem("meditor.language.v1")).toBe("en");
  });

  // ── Browser language fallback ───────────────────────────────────

  it("falls back to Spanish when navigator.language is 'es' and no localStorage is set", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, language: "es-ES" });
    clearLocalStorage();

    renderProvider();

    expect(screen.getByTestId("lang").textContent).toBe("es");
    expect(screen.getByTestId("new-label").textContent).toBe("Nuevo");
  });

  it("falls back to English when navigator.language is unsupported", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, language: "xx-XX" });
    clearLocalStorage();

    renderProvider();

    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("new-label").textContent).toBe("New");
  });

  it("falls back to English when navigator.language is undefined", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, language: undefined });
    clearLocalStorage();

    renderProvider();

    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  // ── localStorage takes precedence over navigator ────────────────

  it("localStorage takes precedence over navigator language", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, language: "es-ES" });
    setLocalStorage("en");

    renderProvider();

    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  // ── French (third language) ─────────────────────────────────────

  it("switches to French and translates strings correctly", () => {
    renderProvider();
    act(() => screen.getByTestId("switch-fr").click());
    expect(screen.getByTestId("lang").textContent).toBe("fr");
    expect(screen.getByTestId("new-label").textContent).toBe("Nouveau");
    expect(screen.getByTestId("loading-label").textContent).toBe("Chargement...");
  });

  it("falls back to French when navigator.language is 'fr' and no localStorage is set", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, language: "fr-FR" });
    clearLocalStorage();

    renderProvider();

    expect(screen.getByTestId("lang").textContent).toBe("fr");
  });

  it("scales: cycles through all three languages correctly", () => {
    renderProvider();
    // en → es → fr → en
    expect(screen.getByTestId("lang").textContent).toBe("en");

    act(() => screen.getByTestId("switch-es").click());
    expect(screen.getByTestId("new-label").textContent).toBe("Nuevo");

    act(() => screen.getByTestId("switch-fr").click());
    expect(screen.getByTestId("new-label").textContent).toBe("Nouveau");

    act(() => screen.getByTestId("switch-en").click());
    expect(screen.getByTestId("new-label").textContent).toBe("New");
  });

  // ── Invalid localStorage value ──────────────────────────────────

  it("ignores invalid localStorage values and falls back to navigator", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, language: "es-ES" });
    window.localStorage.setItem("meditor.language.v1", "invalid-locale");

    renderProvider();

    expect(screen.getByTestId("lang").textContent).toBe("es");
  });
});
