import { useCallback, useEffect, useRef, useState } from "react";
import "../marpPolyfill";
import { browser } from "@marp-team/marp-core/browser";
import { renderMarp } from "../marpEngine";
import { renderMermaidBlocks } from "../previewRenderer";
import type { TranslationFn } from "../i18n/translations";
import "./PresentOverlay.css";

type Props = {
  content: string;
  t: TranslationFn;
  onExit: () => void;
};

/**
 * Full-screen presentation of a Marp deck: one slide at a time, scaled to fill
 * the window (letterboxed, never distorted). Arrow keys and space advance,
 * Escape returns to editing.
 */
export default function PresentOverlay({ content, t, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const helperRef = useRef<ReturnType<typeof browser> | null>(null);
  const seqRef = useRef(0);
  const genRef = useRef(0);
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void import("katex/dist/katex.min.css");
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    // genRef, not seqRef, decides staleness: renderMermaidBlocks advances
    // seqRef per diagram, and comparing against it would abort the very render
    // that started it.
    genRef.current++;
    const myGen = genRef.current;
    const isStale = () => cancelled || myGen !== genRef.current;
    const { html, css } = renderMarp(content);
    helperRef.current?.cleanup();
    el.innerHTML = `<style>${css}</style>${html}`;
    setCount(el.querySelectorAll("svg[data-marpit-svg]").length);
    helperRef.current = browser(el);
    void renderMermaidBlocks(el, seqRef, isStale, t).catch(() => {});
    return () => {
      cancelled = true;
      helperRef.current?.cleanup();
      helperRef.current = null;
    };
  }, [content, t]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const slides = el.querySelectorAll("svg[data-marpit-svg]");
    slides.forEach((slide, i) => slide.classList.toggle("present-active", i === current));
  }, [current, count]);

  const go = useCallback(
    (delta: number) => {
      setCurrent((c) => Math.min(Math.max(c + delta, 0), Math.max(count - 1, 0)));
    },
    [count],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      } else if (
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "PageDown" ||
        e.key === " "
      ) {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrent(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrent(Math.max(count - 1, 0));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, count, onExit]);

  return (
    <div className="present-overlay" role="dialog" aria-modal="true" aria-label={t("present.aria")}>
      <div ref={containerRef} className="present-slides" />
      <div className="present-hud">
        {count > 0 && (
          <span className="present-counter" aria-live="polite">
            {current + 1} / {count}
          </span>
        )}
        <button type="button" className="present-exit" onClick={onExit}>
          {t("present.exit")}
        </button>
      </div>
    </div>
  );
}
