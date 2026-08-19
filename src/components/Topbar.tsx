import { memo, useRef, useEffect, useState, lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Language, TranslationFn } from "../i18n/translations";
import { LANGUAGES, isRtl } from "../i18n/translations";
import type { Theme, Notice, LayoutMode } from "./types";
import brandIcon from "../assets/meditor-icon.png";
import { LATEX_ENABLED } from "../latexSupport";
import "./Topbar.css";

/** Lazy-loaded — only fetched when the user opens the language picker. */
const LanguagePicker = lazy(() => import("./LanguagePicker"));

type Props = {
  t: TranslationFn;
  lang: Language;
  setLanguage: (lang: Language) => void;
  notice: Notice | null;
  busyOperation: string | null;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  zenMode: boolean;
  onToggleZen: () => void;
  onNew: () => void;
  onNewTypst: () => void;
  onNewLatex: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Omitted where the backend cannot produce a PDF for this document. */
  onExportPdf?: () => void;
  /** Only offered for Markdown: Typst/LaTeX render through their own engines. */
  onExportHtml?: () => void;
  onCloseAll: () => void;
  onCloseOthers: () => void;
  onAbout: () => void;
  onPreferences?: () => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  /** Open the editor's find panel — the only route to it without a Ctrl key. */
  onFind: () => void;
  /**
   * The primary pointer is a finger. Drops the split layout from the switch:
   * two panes side by side on a phone is not a layout anyone wants, and a
   * third option only makes the two real ones harder to hit.
   */
  coarsePointer?: boolean;
};

/**
 * Workspace layouts, in the order they appear in the switch: editor on the
 * left, both in the middle, preview on the right — matching what each one
 * shows on screen.
 */
const LAYOUT_MODES: ReadonlyArray<{
  value: LayoutMode;
  labelKey: "layout.editorOnly" | "layout.split" | "layout.previewOnly";
  shortcut: string;
  icon: React.ReactNode;
}> = [
  {
    value: "editor",
    labelKey: "layout.editorOnly",
    shortcut: "Ctrl+1",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    ),
  },
  {
    value: "split",
    labelKey: "layout.split",
    shortcut: "Ctrl+2",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>
    ),
  },
  {
    value: "preview",
    labelKey: "layout.previewOnly",
    shortcut: "Ctrl+3",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
    ),
  },
];

const Topbar = memo(function Topbar({
  t,
  lang,
  setLanguage,
  notice,
  busyOperation,
  menuOpen,
  setMenuOpen,
  theme,
  setTheme,
  zenMode,
  onToggleZen,
  onNew,
  onNewTypst,
  onNewLatex,
  onOpen,
  onSave,
  onSaveAs,
  onExportPdf,
  onExportHtml,
  onCloseAll,
  onCloseOthers,
  onAbout,
  onPreferences,
  layoutMode,
  onLayoutModeChange,
  onFind,
  coarsePointer = false,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const layoutGroupRef = useRef<HTMLDivElement>(null);
  const themeOptionsRef = useRef<HTMLDivElement>(null);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  const currentLang = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  useEffect(() => {
    if (!menuOpen) {
      setLangPickerOpen(false);
      setThemePickerOpen(false);
      return;
    }
    const firstItem = menuRef.current?.querySelector<HTMLElement>("[role=menuitem]");
    firstItem?.focus();

    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClick);
  return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen, setMenuOpen]);

  useEffect(() => {
    if (!themePickerOpen) return;
    themeOptionsRef.current
      ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      ?.focus();
  }, [themePickerOpen]);

  function handleMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ),
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      items[(current + delta + items.length) % items.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      menuToggleRef.current?.focus();
    }
  }

  // What the switch actually offers. Everything below indexes into this, not
  // into LAYOUT_MODES, so the arrow keys walk the buttons that exist.
  const layoutModes = coarsePointer
    ? LAYOUT_MODES.filter((mode) => mode.value !== "split")
    : LAYOUT_MODES;

  // Which button holds the group's single tab stop. Normally the checked one;
  // if the current mode is not on offer — a stored `split` on a touch screen,
  // for the frame before it is migrated — the first one takes it, so the
  // group can never become unreachable by keyboard.
  const focusedMode = layoutModes.some((mode) => mode.value === layoutMode)
    ? layoutMode
    : layoutModes[0].value;

  /** Arrow keys move within the group and select as they go (APG radiogroup). */
  const handleLayoutKeys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const horizontal = e.key === "ArrowRight" || e.key === "ArrowLeft";
    if (!horizontal && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    // In right-to-left interfaces the horizontal arrows are mirrored.
    const rtl = isRtl(lang);
    const forward =
      e.key === "ArrowDown" ||
      (e.key === "ArrowRight" && !rtl) ||
      (e.key === "ArrowLeft" && rtl);
    const current = layoutModes.findIndex((m) => m.value === layoutMode);
    const next =
      (current + (forward ? 1 : -1) + layoutModes.length) % layoutModes.length;
    onLayoutModeChange(layoutModes[next].value);
    const radios =
      layoutGroupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[next]?.focus();
  };

  const busy = busyOperation !== null;

  const themeOptions: [Theme, string, string][] = [
    ["system", t("menu.system"), t("menu.systemDesc")],
    ["light", t("menu.light"), t("menu.lightDesc")],
    ["dark", t("menu.dark"), t("menu.darkDesc")],
    ["contrast", t("menu.contrast"), t("menu.contrastDesc")],
  ];

  const currentThemeOption = themeOptions.find(([v]) => v === theme) ?? themeOptions[0];

  const selectTheme = (value: Theme) => {
    setTheme(value);
    setThemePickerOpen(false);
    setMenuOpen(false);
    menuToggleRef.current?.focus();
  };

  return (
    <header className="topbar">
      <img className="brand-icon" src={brandIcon} alt={t("app.brand")} />
      {notice && (
        <div
          className={`app-notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live={notice.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <span className="app-notice-dot" aria-hidden="true" />
          {notice.message}
        </div>
      )}
      <div className="actions">
        <button type="button" aria-label={t("topbar.newAria")} onClick={onNew} title={t("topbar.newTitle")} disabled={busy}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          <span className="btn-label">{t("topbar.new")}</span>
        </button>
        <button type="button" aria-label={t("topbar.openAria")} onClick={onOpen} title={t("topbar.openTitle")} disabled={busy}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span className="btn-label">{t("topbar.open")}</span>
        </button>
        <button type="button" aria-label={t("topbar.saveAria")} onClick={onSave} title={t("topbar.saveTitle")} disabled={busy}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
          <span className="btn-label">{t("topbar.save")}</span>
        </button>
        <div
          className="layout-switch"
          role="radiogroup"
          aria-label={t("layout.label")}
          ref={layoutGroupRef}
          onKeyDown={handleLayoutKeys}
        >
          {layoutModes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={layoutMode === mode.value}
              // Roving tabindex: the group is one tab stop, arrows move within.
              tabIndex={focusedMode === mode.value ? 0 : -1}
              aria-label={t(mode.labelKey)}
              title={`${t(mode.labelKey)} (${mode.shortcut})`}
              onClick={() => onLayoutModeChange(mode.value)}
            >
              {mode.icon}
            </button>
          ))}
        </div>
        <div className="menu-dropdown" ref={menuRef}>
          <button
            type="button"
            className="menu-toggle"
            disabled={busy}
            title={t("topbar.moreOptions")}
            aria-label={t("topbar.moreOptionsAria")}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls="app-menu"
            ref={menuToggleRef}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          {menuOpen && (
            <div id="app-menu" className="menu-panel" role="menu" aria-label={t("topbar.moreOptions")} onKeyDown={handleMenuKeyDown}>
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onSaveAs(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                {t("menu.saveAs")}<span className="shortcut">{t("menu.shortcut.saveAs")}</span>
              </button>
              {onExportPdf && (
                <button type="button" role="menuitem" disabled={busy} onClick={() => { onExportPdf(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>
                  {t("menu.exportPdf")}<span className="shortcut">{t("menu.shortcut.export")}</span>
                </button>
              )}
              {/* The only way to reach the find panel without a Ctrl key,
                  which is to say: the only way on a phone. */}
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onFind(); setMenuOpen(false); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
                {t("shortcuts.find")}<span className="shortcut">{t("shortcuts.ctrlF")}</span>
              </button>
              {onExportHtml && (
                <button type="button" role="menuitem" disabled={busy} onClick={() => { onExportHtml(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13l-2 2 2 2"/><path d="M15 13l2 2-2 2"/></svg>
                  {t("menu.exportHtml")}
                </button>
              )}
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onNewTypst(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg className="format-icon format-icon-typst" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5h14"/><path d="M12 5v14"/><path d="M8 19h8"/></svg>
                {t("topbar.newTypst")}<span className="shortcut">{t("menu.shortcut.newTypst")}</span>
              </button>
              {LATEX_ENABLED && (
                <button type="button" role="menuitem" disabled={busy} onClick={() => { onNewLatex(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                  <svg className="format-icon format-icon-latex" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 5h12"/><path d="M9 5l3 14"/><path d="M15 5l-3 14"/><path d="M5 19h14"/></svg>
                  {t("topbar.newLatex")}<span className="shortcut">{t("menu.shortcut.newLatex")}</span>
                </button>
              )}
              <div className="menu-sep" />
              <div className="menu-replacedby-section">
                <div className="menu-section-label" aria-hidden="true">{t("menu.theme")}</div>
                <div id="theme-options" ref={themeOptionsRef} hidden={!themePickerOpen}>
                  {themePickerOpen && themeOptions.map(([value, label, description]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={theme === value}
                      disabled={busy}
                      title={description}
                      onClick={() => selectTheme(value)}
                    >
                      <span className="theme-swatch" data-theme-swatch={value} aria-hidden="true" />
                      {label}
                      {theme === value && <span className="theme-check" aria-label={t("menu.selected")}>✓</span>}
                    </button>
                  ))}
                </div>
                {!themePickerOpen && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    aria-expanded={themePickerOpen}
                    aria-controls="theme-options"
                    onClick={() => setThemePickerOpen(true)}
                  >
                    <span className="theme-swatch" data-theme-swatch={currentThemeOption[0]} aria-hidden="true" />
                    {currentThemeOption[1]}
                  </button>
                )}
              </div>
              <div className="menu-sep" />
              <div className="menu-section-label" aria-hidden="true">{t("menu.language")}</div>
              <div id="language-picker" hidden={!langPickerOpen}>
                {langPickerOpen && (
                  <Suspense fallback={<div className="lang-loading">…</div>}>
                    <LanguagePicker
                      lang={lang}
                      t={t}
                      onSelect={(code) => {
                        setLanguage(code);
                        setLangPickerOpen(false);
                        setMenuOpen(false);
                        menuToggleRef.current?.focus();
                      }}
                    />
                  </Suspense>
                )}
              </div>
              {!langPickerOpen && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  aria-expanded={langPickerOpen}
                  aria-controls="language-picker"
                  onClick={() => setLangPickerOpen(true)}
                >
                  {currentLang.nativeLabel}
                </button>
              )}
              <div className="menu-sep" />
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onCloseOthers(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 12h8"/><path d="M3 12h4"/><path d="M3 6h8"/><path d="M13 6h8"/><path d="M3 18h8"/><path d="M13 18h8"/><path d="M16 8l4 4-4 4"/></svg>
                {t("menu.closeOthers")}
              </button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onCloseAll(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                {t("menu.closeAll")}
              </button>
              <div className="menu-sep" />
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onToggleZen(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {zenMode
                    ? <><path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 13h7v7h-7z"/></>
                    : <><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></>
                  }
                </svg>
                {zenMode ? t("menu.zenExit") : t("menu.zenEnter")}
                <span className="shortcut">{t("menu.shortcut.zen")}</span>
              </button>
              <div className="menu-sep" />
              {onPreferences && (
              <button type="button" role="menuitem" onClick={() => { onPreferences(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                {t("menu.preferences")}<span className="shortcut">{t("menu.shortcut.preferences")}</span>
              </button>
              )}
              <button type="button" role="menuitem" disabled={busy} onClick={() => { onAbout(); setMenuOpen(false); menuToggleRef.current?.focus(); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                {t("menu.about")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
});

export default Topbar;
