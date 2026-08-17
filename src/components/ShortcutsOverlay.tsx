import { memo, useEffect, useRef, useState } from "react";
import type { TranslationFn } from "../i18n/translations";
import "./ShortcutsOverlay.css";

type Props = {
  t: TranslationFn;
  onClose: () => void;
};

// Duration of the exit transition in ShortcutsOverlay.css — keep in sync.
const EXIT_MS = 140;

const ShortcutsOverlay = memo(function ShortcutsOverlay({ t, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);

  const shortcuts: [string, string][] = [
    [t("shortcuts.ctrlN"), t("menu.newTab")],
    ["Ctrl+Shift+N", t("topbar.newTypst")],
    ["Ctrl+Shift+L", t("topbar.newLatex")],
    [t("shortcuts.ctrlO"), t("topbar.open")],
    [t("shortcuts.ctrlS"), t("topbar.save")],
    [t("shortcuts.ctrlShiftS"), t("menu.saveAs")],
    [t("shortcuts.ctrlW"), t("shortcuts.closeTab")],
    [t("shortcuts.ctrlTab"), t("shortcuts.nextTab")],
    [t("shortcuts.ctrlShiftTab"), t("shortcuts.prevTab")],
    ["F2", t("tab.rename")],
    [t("shortcuts.ctrlF"), t("shortcuts.find")],
    [t("shortcuts.ctrlK"), t("shortcuts.focusSearch")],
    [t("shortcuts.ctrlH"), t("shortcuts.replace")],
    [t("shortcuts.ctrlG"), t("shortcuts.goToLine")],
    [t("shortcuts.ctrlE"), t("menu.exportPdf")],
    [t("menu.shortcut.preferences"), t("prefs.title")],
    ["F11", t("menu.zenEnter")],
    ["F1", t("shortcuts.title")],
    ["Esc", t("shortcuts.esc")],
  ];

  // Focus the close button on mount and restore focus to the element that
  // opened the overlay when it closes (a11y).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Cancel any pending exit timer if the overlay unmounts early.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Play the CSS exit transition (the `.closing` class) before resolving, so
  // the overlay fades out instead of vanishing instantly. The delay is
  // skipped for prefers-reduced-motion users, matching the CSS media query.
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    closeTimerRef.current = window.setTimeout(onClose, reduced ? 0 : EXIT_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key === "Tab") {
      // Trap the focus inside the overlay: wrap at both ends and pull any
      // stray focus back into the panel.
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
  };

  return (
    <div
      className={"shortcuts-overlay" + (closing ? " closing" : "")}
      role="dialog"
      aria-label={t("shortcuts.title")}
      aria-modal="true"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="shortcuts-panel" ref={panelRef}>
        <div className="shortcuts-header">
          <h2>{t("shortcuts.title")}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="shortcuts-close"
            onClick={requestClose}
            aria-label={t("shortcuts.close")}
          >
            ✕
          </button>
        </div>
        <div className="shortcuts-grid">
          {shortcuts.map(([key, desc]) => (
            <div key={key} className="shortcuts-row">
              <kbd className="shortcuts-key">{key}</kbd>
              <span className="shortcuts-desc">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default ShortcutsOverlay;
