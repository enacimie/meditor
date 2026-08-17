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
};

/** Searchable language combobox rendered inside the topbar menu. */
const LanguagePicker = memo(function LanguagePicker({ lang, t, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionIdPrefix = `${listId}-option`;

  const filtered = query.trim()
    ? LANGUAGES.filter(
        (l) =>
          l.nativeLabel.toLowerCase().includes(query.toLowerCase()) ||
          l.label.toLowerCase().includes(query.toLowerCase()) ||
          l.code.includes(query.toLowerCase()),
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
        onSelect(lang); // close without changing the language
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
    [activeIndex, filtered, lang, onSelect],
  );

  // Re-focus the input when the user clicks the picker background or list.
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".lang-list")) {
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
      <div
        id={listId}
        className="lang-list"
        ref={listRef}
        role="listbox"
      >
        {filtered.length === 0 && (
          <div className="lang-no-results" role="status" aria-live="polite">
            {t("lang.noResults")}
          </div>
        )}
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
