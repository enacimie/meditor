import { memo, useMemo } from "react";
import type { TranslationFn } from "../i18n/translations";
import "./StatusBar.css";

type Props = {
  t: TranslationFn;
  content: string;
  docName?: string;
  dirty?: boolean;
};

function countStats(content: string) {
  const chars = content.length;
  const lines = chars === 0 ? 0 : content.split("\n").length;
  const words = content.trim()
    ? content.trim().split(/\s+/).length
    : 0;
  return { words, lines, chars };
}

const StatusBar = memo(function StatusBar({ t, content, docName, dirty }: Props) {
  const { words, lines, chars } = useMemo(() => countStats(content), [content]);

  return (
    <footer className="statusbar" role="status" aria-live="polite" aria-atomic="true">
      {dirty && <span className="statusbar-dirty" title={t("statusbar.dirtyTitle")} aria-label={t("statusbar.dirtyTitle")}>●</span>}
      {docName && <span className="statusbar-doc" title={docName}>{docName}</span>}
      <span className="statusbar-spacer" />
      <span className="statusbar-stat" title={t("statusbar.wordsTitle")}>
        {t("statusbar.words", words)}
      </span>
      <span className="statusbar-stat" title={t("statusbar.linesTitle")}>
        {t("statusbar.lines", lines)}
      </span>
      <span className="statusbar-stat" title={t("statusbar.charsTitle")}>
        {t("statusbar.chars", chars)}
      </span>
    </footer>
  );
});

export default StatusBar;
