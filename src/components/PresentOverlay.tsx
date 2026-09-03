import { useCallback, useEffect, useRef, useState } from "react";
import "../marpPolyfill";
import { browser } from "@marp-team/marp-core/browser";
import { renderMarp } from "../marpEngine";
import { parseSlidePresents, type SlidePresent } from "../marpPresent";
import { renderMermaidBlocks } from "../previewRenderer";
import type { TranslationFn } from "../i18n/translations";
import "./PresentOverlay.css";

type Props = {
  content: string;
  t: TranslationFn;
  onExit: () => void;
};

type ViewTransition = { finished: Promise<void>; ready: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

function tryStartViewTransition(callback: () => void): boolean {
  const doc = document as ViewTransitionDocument;
  if (typeof doc.startViewTransition !== "function") {
    callback();
    return false;
  }
  try {
    doc.startViewTransition(callback);
    return true;
  } catch {
    // A transition could not start (e.g. one already in flight); apply the
    // change directly rather than strand the deck on the old slide.
    callback();
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Collect the elements of a slide that reveal one step at a time, in the order
 * they appear. Marpit already marks every native fragment step with a
 * `data-marpit-fragment` attribute — by default the items of `*` and `)`
 * lists, the same steps Marp Bespoke paces through (and reflects in its `?f=`
 * URL). On top of that, the `fragment` class opts any element in, and
 * `fragment-list` opts in each of a list/row's children.
 */
function collectFragments(slide: SVGElement): Element[] {
  const native = Array.from(slide.querySelectorAll("[data-marpit-fragment]"));
  const custom: Element[] = [
    ...Array.from(slide.querySelectorAll(".fragment")),
    ...Array.from(slide.querySelectorAll(".fragment-list")).flatMap((list) =>
      Array.from(list.children),
    ),
  ];
  const all = [...native, ...custom].filter((el, i, arr) => arr.indexOf(el) === i);
  all.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return all;
}

type AnimPair = { out: string; in: string };
type TransitionAnim = { fwd: AnimPair; back: AnimPair };

const FADE: TransitionAnim = {
  fwd: { out: "present-vt-fade-out", in: "present-vt-fade-in" },
  back: { out: "present-vt-fade-out", in: "present-vt-fade-in" },
};
const ZOOM: TransitionAnim = {
  fwd: { out: "present-vt-zoom-out", in: "present-vt-zoom-in" },
  back: { out: "present-vt-zoom-out", in: "present-vt-zoom-in" },
};
const SLIDE: TransitionAnim = {
  fwd: { out: "present-vt-slide-out-left", in: "present-vt-slide-in-right" },
  back: { out: "present-vt-slide-out-right", in: "present-vt-slide-in-left" },
};
const WIPE: TransitionAnim = {
  fwd: { out: "present-vt-none", in: "present-vt-wipe-in-ltr" },
  back: { out: "present-vt-none", in: "present-vt-wipe-in-rtl" },
};

const TRANSITION_ANIMATIONS: Record<string, TransitionAnim> = {
  fade: FADE,
  smooth: FADE,
  cover: FADE,
  zoom: ZOOM,
  iris: ZOOM,
  slide: SLIDE,
  pull: SLIDE,
  wipe: WIPE,
  drip: WIPE,
};

function setTransitionVars(type: string, duration: string | null, direction: number) {
  const root = document.documentElement;
  const anim = TRANSITION_ANIMATIONS[type] ?? FADE;
  const pair = direction < 0 ? anim.back : anim.fwd;
  root.style.setProperty("--present-vt-old", pair.out);
  root.style.setProperty("--present-vt-new", pair.in);
  root.style.setProperty("--present-vt-duration", duration ?? "0.45s");
}

/**
 * Full-screen presentation of a Marp deck: one slide at a time, scaled to fill
 * the window (letterboxed, never distorted). Arrow keys and space advance,
 * Escape returns to editing.
 *
 * Slides change through the View Transitions API using the deck's `transition`
 * directive, and elements marked as fragments reveal one step at a time before
 * the deck moves on — both reproduced from Marp Bespoke, the runtime Marp CLI
 * ships in its HTML export.
 */
export default function PresentOverlay({ content, t, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const helperRef = useRef<ReturnType<typeof browser> | null>(null);
  const seqRef = useRef(0);
  const genRef = useRef(0);
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  // Navigation state lives in refs so the keyboard handler never goes stale.
  const currentRef = useRef(0);
  const fragIndexRef = useRef(0);
  const countRef = useRef(0);
  const fragmentsRef = useRef<Element[][]>([]);
  const presentsRef = useRef<SlidePresent[]>([]);

  useEffect(() => {
    void import("katex/dist/katex.min.css");
  }, []);

  const applyActive = useCallback((el: HTMLElement, index: number) => {
    const slides = el.querySelectorAll("svg[data-marpit-svg]");
    slides.forEach((slide, i) => slide.classList.toggle("present-active", i === index));
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

    const slides = Array.from(el.querySelectorAll<SVGElement>("svg[data-marpit-svg]"));
    const presents = parseSlidePresents(content);
    presentsRef.current = presents;
    fragmentsRef.current = slides.map((slide) => {
      const frags = collectFragments(slide);
      for (const frag of frags) frag.classList.add("present-frag");
      return frags;
    });
    countRef.current = slides.length;
    setCount(slides.length);
    helperRef.current = browser(el);
    void renderMermaidBlocks(el, seqRef, isStale, t).catch(() => {});

    // Land on the first slide with its fragments held back.
    currentRef.current = 0;
    fragIndexRef.current = 0;
    setCurrent(0);
    applyActive(el, 0);
    for (const frag of fragmentsRef.current[0] ?? []) {
      frag.classList.add("present-frag-hidden");
    }

    return () => {
      cancelled = true;
      helperRef.current?.cleanup();
      helperRef.current = null;
    };
  }, [content, t, applyActive]);

  const changeSlide = useCallback(
    (dest: number, direction: number) => {
      const el = containerRef.current;
      if (!el) return;
      const apply = () => {
        applyActive(el, dest);
        currentRef.current = dest;
        setCurrent(dest);
        const frags = fragmentsRef.current[dest] ?? [];
        if (direction > 0) {
          for (const frag of frags) frag.classList.add("present-frag-hidden");
          fragIndexRef.current = 0;
        } else {
          for (const frag of frags) frag.classList.remove("present-frag-hidden");
          fragIndexRef.current = frags.length;
        }
      };
      const present = presentsRef.current[dest];
      const type = present?.transition ?? "fade";
      if (type === "none" || prefersReducedMotion()) {
        apply();
        return;
      }
      setTransitionVars(type, present?.duration ?? null, direction);
      tryStartViewTransition(apply);
    },
    [applyActive],
  );

  const goNext = useCallback(() => {
    const idx = currentRef.current;
    const frags = fragmentsRef.current[idx] ?? [];
    if (fragIndexRef.current < frags.length) {
      frags[fragIndexRef.current].classList.remove("present-frag-hidden");
      fragIndexRef.current++;
      return;
    }
    if (idx < countRef.current - 1) changeSlide(idx + 1, 1);
  }, [changeSlide]);

  const goPrev = useCallback(() => {
    const idx = currentRef.current;
    const frags = fragmentsRef.current[idx] ?? [];
    if (fragIndexRef.current > 0) {
      fragIndexRef.current--;
      frags[fragIndexRef.current].classList.add("present-frag-hidden");
      return;
    }
    if (idx > 0) changeSlide(idx - 1, -1);
  }, [changeSlide]);

  const jumpTo = useCallback(
    (dest: number) => {
      const clamped = Math.min(Math.max(dest, 0), Math.max(countRef.current - 1, 0));
      if (clamped === currentRef.current) return;
      changeSlide(clamped, clamped > currentRef.current ? 1 : -1);
    },
    [changeSlide],
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
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Home") {
        e.preventDefault();
        jumpTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        jumpTo(countRef.current - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, jumpTo, onExit]);

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
