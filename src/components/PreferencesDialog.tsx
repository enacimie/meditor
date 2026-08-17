import { memo, useEffect, useRef, useState } from "react";
import type { TranslationFn } from "../i18n/translations";
import {
  EDITOR_FONT_FAMILIES,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  type EditorPreferences,
} from "../editorPreferences";
import "./PreferencesDialog.css";

type Props = {
  t: TranslationFn;
  value: EditorPreferences;
  onChange: (next: EditorPreferences) => void;
  onClose: () => void;
};

// Duration of the exit transition in PreferencesDialog.css — keep in sync.
const EXIT_MS = 140;

const PreferencesDialog = memo(function PreferencesDialog({
  t,
  value,
  onChange,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);

  // Focus the close button on mount and restore focus to whatever opened the
  // dialog when it closes (a11y), like the other dialogs do.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

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
      className={"prefs-overlay" + (closing ? " closing" : "")}
      role="dialog"
      aria-label={t("prefs.title")}
      aria-modal="true"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="prefs-panel" ref={panelRef}>
        <button
          ref={closeBtnRef}
          type="button"
          className="prefs-close"
          onClick={requestClose}
          aria-label={t("prefs.close")}
        >
          ✕
        </button>
        <h2 className="prefs-title">{t("prefs.title")}</h2>

        <section className="prefs-section" aria-labelledby="prefs-editor-heading">
          <h3 className="prefs-section-title" id="prefs-editor-heading">
            {t("prefs.editor")}
          </h3>

          <div className="prefs-row">
            <label className="prefs-label" htmlFor="prefs-font-size">
              {t("prefs.fontSize")}
            </label>
            <div className="prefs-control">
              <input
                id="prefs-font-size"
                type="range"
                min={MIN_EDITOR_FONT_SIZE}
                max={MAX_EDITOR_FONT_SIZE}
                step={1}
                value={value.editorFontSize}
                onChange={(e) =>
                  onChange({ ...value, editorFontSize: Number(e.target.value) })
                }
              />
              <output className="prefs-value" htmlFor="prefs-font-size">
                {t("prefs.pixels", String(value.editorFontSize))}
              </output>
            </div>
          </div>

          <div className="prefs-row">
            <label className="prefs-label" htmlFor="prefs-font-family">
              {t("prefs.fontFamily")}
            </label>
            <div className="prefs-control">
              <select
                id="prefs-font-family"
                value={value.editorFontFamily}
                onChange={(e) =>
                  onChange({ ...value, editorFontFamily: e.target.value })
                }
              >
                {EDITOR_FONT_FAMILIES.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.id === "system" ? t("prefs.fontSystem") : font.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="prefs-preview" style={{
            fontSize: `${value.editorFontSize}px`,
            fontFamily: EDITOR_FONT_FAMILIES.find((f) => f.id === value.editorFontFamily)?.stack,
          }}>
            {t("prefs.sample")}
          </p>
        </section>
      </div>
    </div>
  );
});

export default PreferencesDialog;
