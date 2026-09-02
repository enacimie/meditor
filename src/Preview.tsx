import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { Previewer } from "pagedjs";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "./i18n/I18nProvider";
import pagedCss from "./paged.css?inline";
import latexHighlightCss from "./latex-highlight.css?inline";
import { clearMermaidResources, renderContent, splitLongFencedBlocks } from "./previewRenderer";
import { isPaginatable } from "./pagedLifecycle";
import { fitWideTables, keepHeadingsWithContent } from "./previewRenderer";
import { LATEX_ENABLED } from "./latexSupport";

import type { DocKind } from "./types";
import "./Preview.css";

const TypstPreview = lazy(() => import("./TypstPreview"));
const LatexPreview = lazy(() => import("./LatexPreview"));

const PAGED_STYLES: Array<Record<string, string>> = [
  { "meditor-paged.css": pagedCss },
  { "meditor-latex-highlight.css": latexHighlightCss },
];

function collectStyles(): Array<Record<string, string>> {
  return PAGED_STYLES;
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

async function openExternal(url: string) {
  if (!isSafeExternalUrl(url)) {
    console.warn("Blocked external link:", url);
    return;
  }
  if (isTauri()) {
    try {
      await openUrl(url);
    } catch (e) {
      console.error("Could not open link:", e);
    }
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export type PreviewHandle = {
  scrollToLine: (line: number) => void;
  getTargetLine: () => number;
  clearMark: () => void;
};

type Props = {
  value: string;
  docView: boolean;
  kind: DocKind;
  /** Allow tables too wide for portrait to claim a landscape page. */
  landscapeTables?: boolean;
  onReverseSync: (line: number) => void;
};

/**
 * Safely destroy a paged.js Previewer instance.
 * Uses duck-typing instead of casting to internal types, so it doesn't
 * break when paged.js updates its internals.
 */
function destroyPreviewer(previewer: Previewer | undefined): void {
  if (!previewer) return;
  try {
    const p = previewer as unknown as Record<string, unknown>;
    const polisher = p["polisher"] as { destroy?: () => void } | undefined;
    const chunker = p["chunker"] as { destroy?: () => void } | undefined;
    polisher?.destroy?.();
    chunker?.destroy?.();
  } catch {
    // Best-effort cleanup
  }
}

/** Shared handle shape so we can proxy between the MD implementation
 *  and the Typst/LaTeX child components transparently. */
interface ChildPreviewHandle {
  scrollToLine(line: number): void;
  getTargetLine(): number;
  clearMark(): void;
}

const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { value, docView, kind, landscapeTables = false, onReverseSync },
  ref,
) {
  const { t } = useTranslation();
  const sourceRef = useRef<HTMLDivElement>(null);
  const webRef = useRef<HTMLDivElement>(null);
  const pagedRef = useRef<HTMLDivElement>(null);
  const markedLineRef = useRef<number | null>(null);
  const markedElRef = useRef<HTMLElement | null>(null);
  // When kind is typst/latex, the child component writes its imperative
  // handle here so the PreviewHandle proxy delegates to it.
  const childHandleRef = useRef<ChildPreviewHandle | null>(null);
  const docViewRef = useRef(docView);
  docViewRef.current = docView;
  const onReverseSyncRef = useRef(onReverseSync);
  onReverseSyncRef.current = onReverseSync;

  const seqRef = useRef(0);
  const tokenRef = useRef(0);
  /** A pagination was skipped or interrupted because the pane was hidden. */
  const pendingRef = useRef(false);
  /** Line a sync asked for while the pane had nothing rendered in it. */
  const pendingScrollRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | undefined>(undefined);
  const activePreviewerRef = useRef<Previewer | undefined>(undefined);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Defer preview updates during fast typing to keep the UI responsive
  const deferredValue = useDeferredValue(value);

  async function getPreviewer(): Promise<Previewer> {
    destroyPreviewer(activePreviewerRef.current);
    const { Previewer } = await import("pagedjs");
    const previewer = new Previewer();
    activePreviewerRef.current = previewer;
    return previewer;
  }

  /**
   * Wrap each line inside <pre><code> blocks in <span class="doc-line">
   * so CSS counters can generate line numbers for the Document view.
   */
  function wrapCodeLines(el: HTMLElement): void {
    const pres = Array.from(el.querySelectorAll("pre"));
    for (const pre of pres) {
      const code = pre.querySelector("code");
      if (!code) continue;
      const text = code.innerHTML;
      if (!text.includes("\n")) continue;
      const lines = text.split("\n");
      // Remove trailing empty line from final \n
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      const wrapped = lines
        .map((ln) => `<span class="doc-line"><span class="doc-ln"></span>${ln || " "}</span>`)
        .join("\n");
      code.innerHTML = wrapped;
    }
  }


  function activeContainer(): HTMLElement | null {
    return docViewRef.current ? pagedRef.current : webRef.current;
  }

  /**
   * Scroll to the block covering `line`. Returns false when there is nothing
   * to scroll to yet, which happens while the pane is hidden: rendering into
   * it is deferred, so it holds no [data-line] nodes at all.
   */
  const scrollToLineNow = useCallback((line: number): boolean => {
    // Reads refs only, so this stays stable and the effects below can depend
    // on it without re-running every render.
    const container = docViewRef.current ? pagedRef.current : webRef.current;
    if (!container) return false;
    const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-line]"));
    let target: HTMLElement | null = null;
    for (const n of nodes) {
      const l = parseInt(n.getAttribute("data-line") || "0", 10);
      if (l <= line) target = n;
      else break;
    }
    if (!target && nodes.length) target = nodes[0];
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("sync-flash");
    void target.offsetWidth;
    target.classList.add("sync-flash");
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = undefined;
      target?.classList.remove("sync-flash");
    }, 1300);
    return true;
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      if (childHandleRef.current) {
        childHandleRef.current.scrollToLine(line);
        return;
      }
      // Coming from an editor-only layout the pane has just been revealed and
      // pagination has not run yet, so there is no target to scroll to. Hold
      // the request and let the render apply it, instead of doing nothing and
      // looking like a dead button.
      if (!scrollToLineNow(line)) pendingScrollRef.current = line;
    },
    getTargetLine() {
      if (childHandleRef.current) return childHandleRef.current.getTargetLine();
      if (markedLineRef.current !== null) return markedLineRef.current;
      const container = activeContainer();
      if (!container) return 0;
      const scroller = container.closest(".preview-scroll") as HTMLElement | null;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-line]"),
      );
      for (const n of nodes) {
        if (n.getBoundingClientRect().bottom >= top) {
          return parseInt(n.getAttribute("data-line") || "0", 10);
        }
      }
      return 0;
    },
    clearMark() {
      if (childHandleRef.current) {
        childHandleRef.current.clearMark();
        return;
      }
      clearMark();
    },
  }),
  [scrollToLineNow]);

  function clearMark() {
    if (markedElRef.current) markedElRef.current.classList.remove("sync-marked");
    markedElRef.current = null;
    markedLineRef.current = null;
  }

  // Callback ref that captures the child's imperative handle when
  // kind === "typst" or "latex".
  const setChildHandle = useCallback((h: ChildPreviewHandle | null) => {
    childHandleRef.current = h;
  }, []);

  function markElement(el: HTMLElement) {
    if (markedElRef.current && markedElRef.current !== el) {
      markedElRef.current.classList.remove("sync-marked");
    }
    el.classList.add("sync-marked");
    markedElRef.current = el;
    markedLineRef.current = parseInt(el.getAttribute("data-line") || "0", 10);
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a[href]");
    if (link) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("#")) {
        e.preventDefault();
        try {
          const target = activeContainer()?.querySelector(href);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch {
          /* invalid selector */
        }
        return;
      }
      e.preventDefault();
      void openExternal(href);
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (el) {
      markElement(el);
      if (markedLineRef.current !== null) {
        onReverseSyncRef.current(markedLineRef.current);
      }
    } else clearMark();
  }

  function handleDblClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (!el) return;
    markElement(el);
    if (markedLineRef.current !== null) {
      onReverseSyncRef.current(markedLineRef.current);
    }
  }

  useEffect(() => {
    // Typst and LaTeX previews are handled by their own components —
    // don't fire the markdown/paged.js rendering pipeline for them.
    if (kind === "typst" || kind === "latex") return;

    let cancelled = false;
    let debounceTimer: number | undefined;

    const run = async () => {
      markedLineRef.current = null;
      markedElRef.current = null;
      setRenderError(null);
      tokenRef.current++;
      const myToken = tokenRef.current;
      const isStale = () => cancelled || myToken !== tokenRef.current;
      if (docView) {
        const source = sourceRef.current;
        const paged = pagedRef.current;
        if (!source || !paged) return;
        // paged.js cannot measure a hidden or detached container (zen mode
        // hides the whole pane). Defer until it is on screen again.
        if (!isPaginatable(paged)) {
          pendingRef.current = true;
          return;
        }
        const docValue = splitLongFencedBlocks(deferredValue);
        await renderContent(source, docValue, seqRef, isStale, t);
        if (cancelled || myToken !== tokenRef.current) return;
        /*
         * Measuring tables against a fallback font picks the wrong fit step —
         * or the wrong page orientation — once the real one arrives wider or
         * narrower. The document fonts are declared with @font-face, so this
         * settles as soon as they load and resolves instantly when they are
         * already in.
         */
        await document.fonts.ready;
        if (cancelled || myToken !== tokenRef.current) return;
        console.log("[Preview] calling fitWideTables:", { landscapeTables });
        wrapCodeLines(source);
        keepHeadingsWithContent(source);
        // Last chance to measure: everything below this is a serialised string.
        fitWideTables(source, undefined, landscapeTables, t("preview.landscapeNote"));
        paged.innerHTML = "";
        let previewer: Previewer;
        try {
          previewer = await getPreviewer();
          if (cancelled || myToken !== tokenRef.current) return;
          const html = `<div class="markdown-body doc">${source.innerHTML}</div>`;
          await previewer.preview(html, collectStyles(), paged);
          if (cancelled || myToken !== tokenRef.current) {
            if (activePreviewerRef.current === previewer) {
              activePreviewerRef.current = undefined;
            }
            destroyPreviewer(previewer);
          }
        } catch (e) {
          // Losing the container mid-pagination is not a failure: the user
          // entered zen mode or switched the tab away from Markdown. Retry
          // once it is measurable again instead of reporting an error.
          if (isStale() || !isPaginatable(paged)) {
            pendingRef.current = true;
            return;
          }
          const message = e instanceof Error ? e.message : String(e);
          setRenderError(`${t("preview.pagedError")} ${message}`);
          console.error("paged.js:", e);
        }
      } else {
        const web = webRef.current;
        if (!web) return;
        // Same deferral as the paginated branch: with the pane hidden (zen, or
        // an editor-only layout) rendering into it is work nobody sees. The
        // observer below picks it up when the pane comes back.
        if (!isPaginatable(web)) {
          pendingRef.current = true;
          return;
        }
        await renderContent(web, deferredValue, seqRef, isStale, t);
      }
      flushPendingScroll();
    };

    /**
     * Apply a scroll that was asked for while the pane was empty. Called after
     * a render so the nodes it needs exist by now.
     */
    const flushPendingScroll = () => {
      const line = pendingScrollRef.current;
      if (line === null) return;
      pendingScrollRef.current = null;
      // One frame so the browser has laid the new content out.
      requestAnimationFrame(() => {
        if (!scrollToLineNow(line)) pendingScrollRef.current = line;
      });
    };

    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        void run().catch((e) => {
          if (!cancelled) {
            const message = e instanceof Error ? e.message : String(e);
            setRenderError(`${t("preview.renderError")} ${message}`);
          }
          console.error("preview:", e);
        });
      }, docView ? 250 : 50);
    };

    schedule();
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [deferredValue, docView, landscapeTables, retryToken, t, kind, scrollToLineNow]);

  // Re-run whatever render was skipped while the pane was hidden, as soon as
  // it has a box again — leaving zen mode, switching the layout back, or the
  // tab returning to Markdown. ResizeObserver covers every way it can reappear.
  useEffect(() => {
    const target = docView ? pagedRef.current : webRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pendingRef.current && isPaginatable(target)) {
        pendingRef.current = false;
        setRetryToken((token) => token + 1);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [kind, docView]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== undefined) {
        window.clearTimeout(flashTimerRef.current);
      }
      destroyPreviewer(activePreviewerRef.current);
      activePreviewerRef.current = undefined;
      void clearMermaidResources();
    };
  }, []);

  if (kind === "typst") {
    return (
      <Suspense fallback={<div className="typst-loading" role="status"><span className="typst-spinner" aria-hidden="true" />{t("preview.typstCompiling")}</div>}>
        <TypstPreview ref={setChildHandle} value={value} t={t} onReverseSync={onReverseSync} />
      </Suspense>
    );
  }

  if (kind === "latex") {
    if (!LATEX_ENABLED) {
      return (
        <div className="latex-notice">
          <span className="latex-notice-icon" aria-hidden="true">📄</span>
          <span>{t("preview.latexDisabled")}</span>
        </div>
      );
    }
    return (
      <Suspense fallback={<div className="typst-loading" role="status"><span className="typst-spinner" aria-hidden="true" />{t("app.loading")}</div>}>
        <LatexPreview ref={setChildHandle} value={value} t={t} onReverseSync={onReverseSync} />
      </Suspense>
    );
  }

  return (
    <>
      <div ref={sourceRef} className="markdown-body doc preview-source" />
      <div
        ref={webRef}
        className="markdown-body"
        style={{ display: docView ? "none" : "block" }}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
      />
      <div
        ref={pagedRef}
        className="paged-view"
        style={{ display: docView ? "block" : "none" }}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
      />
      {renderError && (
        <div className="preview-error" role="alert" aria-live="assertive">
          <strong>{t("preview.unavailable")}</strong>
          <span>{renderError}</span>
          <button type="button" onClick={() => setRetryToken((token) => token + 1)}>
            {t("preview.retry")}
          </button>
        </div>
      )}
    </>
  );
});

export default Preview;
