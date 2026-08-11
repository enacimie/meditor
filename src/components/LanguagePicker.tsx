import { memo, useState, useRef, useEffect, useCallback } from "react";
import type { Language } from "../i18n/translations";
import { LANGUAGES } from "../i18n/translations";
import "./LanguagePicker.css";

import type { TranslationFn } from "../i18n/translations";

type Props = {
  lang: Language;
  t: TranslationFn;
  /** Called when user selects a language. The parent should close the menu afterwards. */
  onSelect: (code: Language) => void;
};

/** Searchable dropdown for picking among 20 supported languages. */
const LanguagePicker = memo(function LanguagePicker({ lang, t, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the search input when mounted
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view after filtering
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [query]);

  const filtered = query.trim()
    ? LANGUAGES.filter(
        (l) =>
          l.nativeLabel.toLowerCase().includes(query.toLowerCase()) ||
          l.label.toLowerCase().includes(query.toLowerCase()) ||
          l.code.includes(query.toLowerCase()),
      )
    : LANGUAGES;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSelect(lang); // signal to close without changing
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = listRef.current?.querySelectorAll<HTMLElement>(
          "button",
        );
        if (!items || !items.length) return;
        const current = Array.from(items).indexOf(
          document.activeElement as HTMLElement,
        );
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next =
          current === -1
            ? items[0]
            : items[(current + delta + items.length) % items.length];
        next.focus();
      }
    },
    [lang, onSelect],
  );

  // Re-focus input when user clicks away and back
  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
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
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={t("lang.searchAria")}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="lang-search-clear"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label={t("lang.clearSearch")}
          >
            ×
          </button>
        )}
      </div>
      <div className="lang-list" ref={listRef} role="listbox">
        {filtered.length === 0 && (
          <div className="lang-no-results">{t("lang.noResults")}</div>
        )}
        {filtered.map((l) => (
          <button
            key={l.code}
            ref={l.code === lang ? selectedRef : undefined}
            type="button"
            role="option"
            aria-selected={l.code === lang}
            className={`lang-option${l.code === lang ? " lang-option--selected" : ""}`}
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
