import { memo, useMemo } from "react";
import type { TranslationFn } from "../i18n/translations";
import "./StatusBar.css";

type Props = {
  t: TranslationFn;
  content: string;
  docName?: string;
  dirty?: boolean;
  /** Where the caret is, one-based, as a reader counts. */
  cursorLine?: number;
  cursorColumn?: number;
};

/**
 * Words a minute, for the reading estimate.
 *
 * 200 is the middle of the range silent reading of prose is usually put at,
 * and the number every editor that shows this uses. It is an estimate of a
 * document's size in a unit people have a feel for, not a measurement.
 */
const WORDS_PER_MINUTE = 200;

function countStats(content: string) {
  const chars = content.length;
  const lines = chars === 0 ? 0 : content.split("\n").length;
  const words = content.trim()
    ? content.trim().split(/\s+/).length
    : 0;
  // A document with words in it never reads in "0 min": rounding up keeps the
  // smallest answer the smallest true one.
  const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  return { words, lines, chars, minutes };
}

const StatusBar = memo(function StatusBar({
  t,
  content,
  docName,
  dirty,
  cursorLine,
  cursorColumn,
}: Props) {
  const { words, lines, chars, minutes } = useMemo(() => countStats(content), [content]);

  return (
    <footer className="statusbar" role="status" aria-live="polite" aria-atomic="true">
      {dirty && <span className="statusbar-dirty" title={t("statusbar.dirtyTitle")} aria-label={t("statusbar.dirtyTitle")}>●</span>}
      {docName && <span className="statusbar-doc" title={docName}>{docName}</span>}
      <span className="statusbar-spacer" />
      {/*
        The caret's own position, which the editor already knew and only the
        outline was being told. Secondary because a phone has no room for it,
        and because someone reading rather than writing does not need it.
      */}
      {cursorLine !== undefined && cursorColumn !== undefined && (
        <span className="statusbar-stat statusbar-secondary" title={t("statusbar.cursorTitle")}>
          {t("statusbar.cursor", cursorLine, cursorColumn)}
        </span>
      )}
      <span className="statusbar-stat" title={t("statusbar.wordsTitle")}>
        {t("statusbar.words", words)}
      </span>
      <span className="statusbar-stat statusbar-secondary" title={t("statusbar.readingTimeTitle")}>
        {t("statusbar.readingTime", minutes)}
      </span>
      {/* Named so the narrow-screen rule can drop them without counting
          children: three localised counts do not fit on a phone. */}
      <span className="statusbar-stat statusbar-secondary" title={t("statusbar.linesTitle")}>
        {t("statusbar.lines", lines)}
      </span>
      <span className="statusbar-stat statusbar-secondary" title={t("statusbar.charsTitle")}>
        {t("statusbar.chars", chars)}
      </span>
    </footer>
  );
});

export default StatusBar;
