import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { TranslationFn } from "./i18n/translations";
import "./marpPolyfill";
import { browser } from "@marp-team/marp-core/browser";
import { renderMarp } from "./marpEngine";
import { slideStartLines } from "./marpSlides";
import { renderMermaidBlocks } from "./previewRenderer";
import "./MarpPreview.css";

export type MarpPreviewHandle = {
  scrollToLine: (line: number) => void;
  getTargetLine: () => number;
  clearMark: () => void;
};

type Props = {
  value: string;
  t: TranslationFn;
  onReverseSync: (line: number) => void;
};

/**
 * Live preview of a Marp deck: every slide rendered to a responsive inline-SVG
 * and stacked vertically. Sync is slide-granular — each slide carries the
 * source line it starts on, since Marp's own output has no source positions.
 */
const MarpPreview = forwardRef<MarpPreviewHandle, Props>(
  function MarpPreview({ value, t, onReverseSync }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const markedElRef = useRef<SVGElement | null>(null);
    const markedLineRef = useRef<number | null>(null);
    const flashTimerRef = useRef<number | undefined>(undefined);
    const helperRef = useRef<ReturnType<typeof browser> | null>(null);
    const seqRef = useRef(0);
    const genRef = useRef(0);

    // KaTeX markup inside slides needs meditor's KaTeX CSS for the fonts; the
    // engine strips the plugin's CDN @font-face rules.
    useEffect(() => {
      void import("katex/dist/katex.min.css");
    }, []);

    useEffect(
      () => () => {
        if (flashTimerRef.current !== undefined) {
          window.clearTimeout(flashTimerRef.current);
        }
        helperRef.current?.cleanup();
        helperRef.current = null;
      },
      [],
    );

    const renderDeck = useCallback(async () => {
      const el = containerRef.current;
      if (!el) return;
      // Staleness rides genRef, not seqRef: renderMermaidBlocks advances
      // seqRef per diagram as it works, which would otherwise mark the render
      // that kicked it off as stale and strand every diagram on its spinner.
      genRef.current++;
      const myGen = genRef.current;
      const isStale = () => myGen !== genRef.current || !el.isConnected;
      try {
        const { html, css } = renderMarp(value);
        // Printing sizes the page to the slide itself; the web build's
        // window.print() honours this @page rule, and the native exporter is
        // handed the same dimensions separately.
        const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(html);
        const pageRule = viewBox
          ? `@page{size:${viewBox[1]}px ${viewBox[2]}px;margin:0;}`
          : "";
        helperRef.current?.cleanup();
        el.innerHTML = `<style>${css}${pageRule}</style>${html}`;
        const starts = slideStartLines(value);
        const slides = el.querySelectorAll<SVGElement>("svg[data-marpit-svg]");
        slides.forEach((slide, i) => {
          const line = starts[i] ?? starts[starts.length - 1] ?? 0;
          slide.setAttribute("data-line", String(line));
        });
        helperRef.current = browser(el);
        setError(null);
        // Mermaid fences arrive as plain code blocks; diagram them with the
        // same pool the Markdown preview uses.
        await renderMermaidBlocks(el, seqRef, isStale, t);
      } catch (e) {
        if (isStale()) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(`${t("preview.renderError")} ${message}`);
      }
    }, [value, t]);

    useEffect(() => {
      const timer = window.setTimeout(renderDeck, 120);
      return () => window.clearTimeout(timer);
    }, [renderDeck, retryToken]);

    function slides(): SVGElement[] {
      const el = containerRef.current;
      if (!el) return [];
      return Array.from(el.querySelectorAll<SVGElement>("svg[data-marpit-svg]"));
    }

    function flash(slide: SVGElement) {
      slide.classList.remove("sync-flash");
      void slide.getBoundingClientRect();
      slide.classList.add("sync-flash");
      if (flashTimerRef.current !== undefined) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = undefined;
        slide.classList.remove("sync-flash");
      }, 1300);
    }

    function mark(slide: SVGElement) {
      if (markedElRef.current && markedElRef.current !== slide) {
        markedElRef.current.classList.remove("sync-marked");
      }
      slide.classList.add("sync-marked");
      markedElRef.current = slide;
      markedLineRef.current = parseInt(slide.getAttribute("data-line") || "0", 10);
    }

    function clearMark() {
      if (markedElRef.current) markedElRef.current.classList.remove("sync-marked");
      markedElRef.current = null;
      markedLineRef.current = null;
    }

    useImperativeHandle(ref, () => ({
      scrollToLine(line: number) {
        const list = slides();
        let target: SVGElement | null = null;
        for (const slide of list) {
          const l = parseInt(slide.getAttribute("data-line") || "0", 10);
          if (l <= line) target = slide;
          else break;
        }
        if (!target && list.length) target = list[0];
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        flash(target);
      },
      getTargetLine(): number {
        if (markedLineRef.current !== null) return markedLineRef.current;
        const el = containerRef.current;
        if (!el) return 0;
        const scroller = el.closest(".preview-scroll") as HTMLElement | null;
        const top = scroller ? scroller.getBoundingClientRect().top : 0;
        for (const slide of slides()) {
          if (slide.getBoundingClientRect().bottom >= top) {
            return parseInt(slide.getAttribute("data-line") || "0", 10);
          }
        }
        return 0;
      },
      clearMark,
    }));

    function handleClick(e: MouseEvent) {
      const slide = (e.target as Element).closest<SVGElement>("svg[data-marpit-svg]");
      if (!slide) {
        clearMark();
        return;
      }
      mark(slide);
      if (markedLineRef.current !== null) onReverseSync(markedLineRef.current);
    }

    return (
      <div className="marp-preview">
        {error && (
          <div className="preview-error" role="alert" aria-live="assertive">
            <strong>{t("preview.unavailable")}</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setRetryToken((n) => n + 1)}>
              {t("preview.retry")}
            </button>
          </div>
        )}
        <div ref={containerRef} className="marp-slides" onClick={handleClick} />
      </div>
    );
  },
);

export default MarpPreview;
