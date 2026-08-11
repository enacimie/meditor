import { memo, useMemo } from "react";
import type { TranslationFn } from "../i18n/translations";
import type { Heading } from "./outlineUtils";
import { findActiveHeading } from "./outlineUtils";
import "./Outline.css";

type Props = {
  t: TranslationFn;
  headings: Heading[];
  cursorLine?: number;
  onGoToLine: (line: number) => void;
};

const Outline = memo(function Outline({ t, headings, cursorLine, onGoToLine }: Props) {
  const activeLine = useMemo(
    () => (cursorLine !== undefined ? findActiveHeading(headings, cursorLine) : undefined),
    [headings, cursorLine],
  );

  if (!headings.length) {
    return (
      <div className="outline-empty" role="status">
        {t("outline.empty")}
      </div>
    );
  }

  return (
    <nav className="outline" aria-label={t("outline.label")}>
      <ul className="outline-list" role="list">
        {headings.map((h, i) => (
          <li
            key={i}
            className={
              "outline-item" +
              (activeLine === h.line ? " outline-active" : "")
            }
            style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}
          >
            <button
              type="button"
              className="outline-link"
              onClick={() => onGoToLine(h.line)}
              title={`${"#".repeat(h.level)} ${h.text}`}
            >
              <span className="outline-marker" aria-hidden="true">
                {"#".repeat(h.level)}
              </span>
              <span className="outline-text">{h.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
});

export default Outline;
