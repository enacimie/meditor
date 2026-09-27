import { memo, useState, useRef, useEffect, useCallback, useId } from "react";
import type { Language } from "../i18n/translations";
import { LANGUAGES } from "../i18n/translations";
import "./LanguagePicker.css";

import type { TranslationFn } from "../i18n/translations";

type Props = {
  lang: Language;
  t: TranslationFn;
  /** Called when the user selects a language. The parent closes the menu afterwards. */
  onSelect: (code: Language) => void;
  /**
   * Called when the picker is dismissed without choosing (Escape). The
   * parent closes the picker only — the menu stays, and the language is
   * not re-decided, which re-applying the current one on the way out used
   * to do (rewriting `<html>` and the stored choice for nothing).
   */
  onCancel: () => void;
};

/** Searchable language combobox rendered inside the topbar menu. */
const LanguagePicker = memo(function LanguagePicker({ lang, t, onSelect, onCancel }: Props) {
  const [query, setQuery] = useState("");
  /*
   * The active row starts on the language in use, not on the first row:
   * Enter right after opening used to switch the whole interface to
   * English, whichever language it was speaking.
   */
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, LANGUAGES.findIndex((l) => l.code === lang)),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionIdPrefix = `${listId}-option`;

  // The emptiness test trims, so the filter has to as well: a query that is
  // only spaces used to announce "empty" and then search for the spaces.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? LANGUAGES.filter(
        (l) =>
          l.nativeLabel.toLowerCase().includes(q) ||
          l.label.toLowerCase().includes(q) ||
          l.code.toLowerCase().includes(q),
      )
    : LANGUAGES;

  const activeCode = filtered[activeIndex]?.code;

  // Keep the active option valid after filtering and scroll it into view.
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!activeCode) return;
    document.getElementById(`${optionIdPrefix}-${activeCode}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeCode, optionIdPrefix]);

  // Auto-focus the combobox when mounted.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel(); // close the picker, not the menu, and change nothing
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (!filtered.length) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) =>
          (index + delta + filtered.length) % filtered.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const active = filtered[activeIndex];
        if (active) onSelect(active.code);
      }
    },
    [activeIndex, filtered, onSelect, onCancel],
  );

  // Re-focus the input when the user clicks the picker background or the
  // list's empty space — but not an option: that click already chose a
  // language and unmounted the picker, and focusing the input on the way
  // out dropped the focus on the body.
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".lang-option")) return;
    if (target === e.currentTarget || target.closest(".lang-list")) {
      inputRef.current?.focus();
    }
  }, []);

  return (
    <div className="lang-picker" onClick={handleContainerClick}>
      <div className="lang-search-wrapper">
        <svg
          className="lang-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="lang-search-input"
          placeholder={t("lang.searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          aria-label={t("lang.searchAria")}
          role="combobox"
          aria-controls={listId}
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeCode ? `${optionIdPrefix}-${activeCode}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="lang-search-clear"
            onClick={() => {
              setQuery("");
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
            aria-label={t("lang.clearSearch")}
          >
            ×
          </button>
        )}
      </div>
      {/* A live region, but not a child of the listbox: role="listbox" may
          only own options and groups, and a status div inside it is both an
          invalid child and a poor announcement. */}
      {filtered.length === 0 && (
        <div className="lang-no-results" role="status" aria-live="polite">
          {t("lang.noResults")}
        </div>
      )}
      <div
        id={listId}
        className="lang-list"
        role="listbox"
      >
        {filtered.map((l, index) => (
          <button
            key={l.code}
            id={`${optionIdPrefix}-${l.code}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={l.code === lang}
            className={`lang-option${l.code === lang ? " lang-option--selected" : ""}${index === activeIndex ? " lang-option--active" : ""}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onSelect(l.code)}
          >
            <span className="lang-native">{l.nativeLabel}</span>
            <span className="lang-label">{l.label}</span>
            {l.code === lang && (
              <span className="lang-check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});

export default LanguagePicker;
