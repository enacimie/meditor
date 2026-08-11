import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type MouseEvent,
} from "react";
import type { TranslationFn } from "./i18n/translations";
import "./Preview.css";

export type LatexPreviewHandle = {
  scrollToLine: (line: number) => void;
  getTargetLine: () => number;
  clearMark: () => void;
};

type Props = {
  value: string;
  t: TranslationFn;
  onReverseSync: (line: number) => void;
};

const LatexPreview = forwardRef<LatexPreviewHandle, Props>(
  function LatexPreview({ value, t, onReverseSync }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const preRef = useRef<HTMLPreElement>(null);
    const markedLineRef = useRef<number | null>(null);

    /** Read the actual line-height from the <pre> element's computed style. */
    function getLineHeight(): number {
      const pre = preRef.current;
      if (!pre) return 22; // fallback to CSS default
      const style = getComputedStyle(pre);
      const lh = parseFloat(style.lineHeight);
      return isNaN(lh) || lh <= 0 ? 22 : lh;
    }

    useImperativeHandle(ref, () => ({
      scrollToLine(line: number) {
        const pre = preRef.current;
        if (!pre || !containerRef.current) return;
        // LaTeX source: each line is a text node or <span> inside the <pre>
        const lines = pre.innerText.split("\n");
        const targetLine = Math.min(line, lines.length - 1);
        // Scroll the container so the target line is roughly centered
        const lineHeight = getLineHeight();
        const scrollTarget = Math.max(0, targetLine * lineHeight - containerRef.current.clientHeight / 2);
        containerRef.current.scrollTo({ top: scrollTarget, behavior: "smooth" });
      },
      getTargetLine(): number {
        if (markedLineRef.current !== null) return markedLineRef.current;
        const container = containerRef.current;
        if (!container) return 0;
        const scrollTop = container.scrollTop;
        const lineHeight = getLineHeight();
        return Math.floor(scrollTop / lineHeight);
      },
      clearMark() {
        markedLineRef.current = null;
      },
    }));

    function handleClick(e: MouseEvent) {
      const pre = preRef.current;
      if (!pre) return;
      // Approximate clicked line from click position
      const rect = pre.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const lineHeight = getLineHeight();
      const line = Math.floor(clickY / lineHeight);
      markedLineRef.current = line;
      if (line >= 0) onReverseSync(line);
    }

    return (
      <div ref={containerRef} className="latex-preview" onClick={handleClick}>
        <div className="latex-notice">
          <span className="latex-notice-icon" aria-hidden="true">📄</span>
          <span>{t("preview.latexNotice")}</span>
        </div>
        <pre ref={preRef} className="latex-source">
          {value || t("preview.latexEmpty")}
        </pre>
      </div>
    );
  },
);

export default LatexPreview;
