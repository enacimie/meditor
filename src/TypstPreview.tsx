import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { TranslationFn } from "./i18n/translations";
import "./Preview.css";

// Lazy-load the Typst compiler — ~3 MB WASM binary that we only fetch when
// the user opens a .typ document.
let typstReady: Promise<boolean> | null = null;
function ensureTypst(): Promise<boolean> {
  if (!typstReady) {
    typstReady = import("@myriaddreamin/typst.ts").then(
      () => true,
      () => false,
    );
  }
  return typstReady;
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
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const seqRef = useRef(0);

    useImperativeHandle(ref, () => ({
      scrollToLine(_line: number) {
        // TODO: implement with sourceSpan mapping in Phase 4
      },
      getTargetLine(): number {
        // TODO: implement in Phase 4
        return 0;
      },
      clearMark() {
        // TODO: implement in Phase 4
      },
    }));

    useEffect(() => {
      let cancelled = false;
      const run = async () => {
        const ok = await ensureTypst();
        if (cancelled || !ok) {
          if (!cancelled) setError("Could not load Typst compiler");
          return;
        }
        setLoading(true);
        setError(null);
        seqRef.current++;
        const mySeq = seqRef.current;
        try {
          const { $typst } = await import("@myriaddreamin/typst.ts");
          if (cancelled || mySeq !== seqRef.current) return;
          const result = await $typst.svg({ mainContent: value });
          if (cancelled || mySeq !== seqRef.current) return;
          setSvg(result);
          setLoading(false);
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
    }, [value, t]);

    function handleClick(e: MouseEvent) {
      // Typst SVGs have data-source-loc attributes for source mapping.
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-source-loc]",
      );
      if (el) {
        const loc = el.getAttribute("data-source-loc");
        if (loc) {
          // data-source-loc format: "line:column" or similar
          const line = parseInt(loc.split(":")[0], 10);
          if (!isNaN(line)) onReverseSync(line);
        }
      }
    }

    return (
      <div
        ref={containerRef}
        className="typst-preview"
        onClick={handleClick}
        style={{ overflow: "auto", height: "100%", padding: "1rem" }}
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
          </div>
        )}
        {svg && (
          <div
            className="typst-output"
            aria-label="Typst preview"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    );
  },
);

export default TypstPreview;
