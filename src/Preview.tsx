import {
  forwardRef,
  lazy,
  Suspense,
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
import { clearMermaidCache, destroyMermaidPool } from "./mermaidPool";
import { renderContent, splitLongFencedBlocks } from "./previewRenderer";
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

const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { value, docView, kind, onReverseSync },
  ref,
) {
  const { t } = useTranslation();
  const sourceRef = useRef<HTMLDivElement>(null);
  const webRef = useRef<HTMLDivElement>(null);
  const pagedRef = useRef<HTMLDivElement>(null);
  const markedLineRef = useRef<number | null>(null);
  const markedElRef = useRef<HTMLElement | null>(null);
  const docViewRef = useRef(docView);
  docViewRef.current = docView;
  const onReverseSyncRef = useRef(onReverseSync);
  onReverseSyncRef.current = onReverseSync;

  const seqRef = useRef(0);
  const tokenRef = useRef(0);
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

  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      const container = activeContainer();
      if (!container) return;
      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-line]"),
      );
      let target: HTMLElement | null = null;
      for (const n of nodes) {
        const l = parseInt(n.getAttribute("data-line") || "0", 10);
        if (l <= line) target = n;
        else break;
      }
      if (!target && nodes.length) target = nodes[0];
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("sync-flash");
      void target.offsetWidth;
      target.classList.add("sync-flash");
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = undefined;
        target?.classList.remove("sync-flash");
      }, 1300);
    },
    getTargetLine() {
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
    clearMark,
  }));

  function clearMark() {
    if (markedElRef.current) markedElRef.current.classList.remove("sync-marked");
    markedElRef.current = null;
    markedLineRef.current = null;
  }

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
        const docValue = splitLongFencedBlocks(deferredValue);
        await renderContent(source, docValue, seqRef, isStale, t);
        if (cancelled || myToken !== tokenRef.current) return;
        wrapCodeLines(source);
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
          if (!isStale()) {
            const message = e instanceof Error ? e.message : String(e);
            setRenderError(`${t("preview.pagedError")} ${message}`);
          }
          console.error("paged.js:", e);
        }
      } else {
        const web = webRef.current;
        if (!web) return;
        await renderContent(web, deferredValue, seqRef, isStale, t);
      }
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
  }, [deferredValue, docView, retryToken, t, kind]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== undefined) {
        window.clearTimeout(flashTimerRef.current);
      }
      destroyPreviewer(activePreviewerRef.current);
      activePreviewerRef.current = undefined;
      clearMermaidCache();
      destroyMermaidPool();
    };
  }, []);

  if (kind === "typst") {
    return (
      <Suspense fallback={<div className="typst-loading" role="status"><span className="typst-spinner" aria-hidden="true" />{t("preview.typstCompiling")}</div>}>
        <TypstPreview value={value} t={t} onReverseSync={onReverseSync} />
      </Suspense>
    );
  }

  if (kind === "latex") {
    return (
      <Suspense fallback={<div className="typst-loading" role="status"><span className="typst-spinner" aria-hidden="true" />{t("app.loading")}</div>}>
        <LatexPreview value={value} t={t} onReverseSync={onReverseSync} />
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
