import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { TranslationFn } from "./i18n/translations";
import { getTypst } from "./typstEngine";
import "./Preview.css";

/**
 * Parse a data-source-loc attribute from typst.ts SVGs.
 * Format is typically "line:column" or "startLine:startCol,endLine:endCol".
 * Returns the start line (1-based from Typst, 0-based for the editor).
 */
function parseSourceLine(loc: string): number {
  const comma = loc.indexOf(",");
  const segment = comma > 0 ? loc.slice(0, comma) : loc;
  const colon = segment.indexOf(":");
  const lineStr = colon > 0 ? segment.slice(0, colon) : segment;
  const line = parseInt(lineStr, 10);
  return isNaN(line) ? -1 : line;
}

export type TypstPreviewHandle = {
  scrollToLine: (line: number) => void;
  getTargetLine: () => number;
  clearMark: () => void;
};

type Props = {
  value: string;
  t: TranslationFn;
  onReverseSync: (line: number) => void;
};

const TypstPreview = forwardRef<TypstPreviewHandle, Props>(
  function TypstPreview({ value, t, onReverseSync }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const outputRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [retryToken, setRetryToken] = useState(0);
    const [pageCount, setPageCount] = useState(0);
    const seqRef = useRef(0);
    const markedElRef = useRef<Element | null>(null);
    const markedLineRef = useRef<number | null>(null);
    const flashTimerRef = useRef<number | undefined>(undefined);

    useImperativeHandle(ref, () => ({
      scrollToLine(line: number) {
        const container = containerRef.current;
        if (!container) return;
        // Typst lines are 1-based, editor lines are 0-based
        const typstLine = line + 1;
        // Find the first element whose source-loc starts at this line
        const candidates = Array.from(
          container.querySelectorAll<HTMLElement>("[data-source-loc]"),
        );
        let target: HTMLElement | null = null;
        for (const el of candidates) {
          const loc = el.getAttribute("data-source-loc");
          if (!loc) continue;
          const parsed = parseSourceLine(loc);
          if (parsed < 0) continue;
          if (parsed <= typstLine) target = el;
          else break;
        }
        if (!target && candidates.length) target = candidates[0];
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("sync-flash");
        void (target as HTMLElement).offsetWidth;
        target.classList.add("sync-flash");
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = undefined;
          target?.classList.remove("sync-flash");
        }, 1300);
      },
      getTargetLine(): number {
        if (markedLineRef.current !== null) return markedLineRef.current;
        const container = containerRef.current;
        if (!container) return 0;
        const scroller = container.closest(".preview-scroll") as HTMLElement | null;
        const top = scroller ? scroller.getBoundingClientRect().top : 0;
        const nodes = Array.from(
          container.querySelectorAll<HTMLElement>("[data-source-loc]"),
        );
        for (const n of nodes) {
          if (n.getBoundingClientRect().bottom >= top) {
            const loc = n.getAttribute("data-source-loc") ?? "";
            const parsed = parseSourceLine(loc);
            // Convert 1-based Typst line to 0-based editor line
            return parsed > 0 ? parsed - 1 : 0;
          }
        }
        return 0;
      },
      clearMark() {
        if (markedElRef.current) {
          markedElRef.current.classList.remove("sync-marked");
        }
        markedElRef.current = null;
        markedLineRef.current = null;
      },
    }));

    useEffect(() => {
      let cancelled = false;
      const run = async () => {
        let $typst: typeof import("@myriaddreamin/typst.ts")["$typst"];
        try {
          const mod = await getTypst();
          $typst = mod.$typst;
        } catch {
          if (!cancelled) {
            setError("Could not load Typst compiler");
          }
          return;
        }
        if (cancelled) return;
        setLoading(true);
        setError(null);
        seqRef.current++;
        const mySeq = seqRef.current;
        try {
          const result = await $typst.svg({ mainContent: value });
          if (cancelled || mySeq !== seqRef.current) return;
          setSvg(result);
          setLoading(false);
          // Count <svg> elements to know how many pages were rendered
          const count = (result.match(/<svg[\s>]/g) || []).length;
          setPageCount(count);
        } catch (e) {
          if (cancelled || mySeq !== seqRef.current) return;
          const message = e instanceof Error ? e.message : String(e);
          setError(`${t("preview.typstError")} ${message}`);
          setLoading(false);
        }
      };
      // Debounce: Typst compilation is fast but we still want to avoid
      // spamming recompilations on every keystroke.
      const timer = window.setTimeout(() => {
        void run();
      }, 250);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [value, t, retryToken]);

    function handleClick(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-source-loc]",
      );
      if (el) {
        if (markedElRef.current && markedElRef.current !== el) {
          markedElRef.current.classList.remove("sync-marked");
        }
        el.classList.add("sync-marked");
        markedElRef.current = el;
        const loc = el.getAttribute("data-source-loc") ?? "";
        const parsed = parseSourceLine(loc);
        if (parsed > 0) {
          markedLineRef.current = parsed - 1; // 0-based
          onReverseSync(markedLineRef.current);
        }
      } else {
        if (markedElRef.current) {
          markedElRef.current.classList.remove("sync-marked");
        }
        markedElRef.current = null;
        markedLineRef.current = null;
      }
    }

    return (
      <div
        ref={containerRef}
        className="typst-preview"
        onClick={handleClick}
      >
        {loading && !svg && (
          <div className="typst-loading" role="status">
            <span className="typst-spinner" aria-hidden="true" />
            {t("preview.typstCompiling")}
          </div>
        )}
        {error && (
          <div className="preview-error" role="alert" aria-live="assertive">
            <strong>{t("preview.unavailable")}</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setRetryToken((t) => t + 1)}>
              {t("preview.retry")}
            </button>
          </div>
        )}
        {svg && (
          <div
            ref={outputRef}
            className="typst-output"
            aria-label="Typst preview"
          >
            {pageCount > 1 && (
              <span className="typst-page-counter" aria-live="polite">
                {pageCount} {t("preview.pages")}
              </span>
            )}
            <div className="typst-svg-wrapper" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        )}
      </div>
    );
  },
);

export default TypstPreview;
