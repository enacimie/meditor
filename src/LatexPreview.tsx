import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { TranslationFn } from "./i18n/translations";
import { getLatexEngineClass, type PdfTeXEngineInstance } from "./latexEngine";
import "./Preview.css";

// ---- Component ----

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

function isMissingFormatError(status: number, log: string): boolean {
  return (
    status !== 0 &&
    /format file.*(?:can't find|not found)|can't find the format file/i.test(log)
  );
}

function revokePdfUrl(
  pdfUrlRef: { current: string | null },
  setPdfUrl: (url: string | null) => void,
): void {
  const currentUrl = pdfUrlRef.current;
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    pdfUrlRef.current = null;
  }
  setPdfUrl(null);
}

const LatexPreview = forwardRef<LatexPreviewHandle, Props>(
  function LatexPreview({ value, t, onReverseSync: _onReverseSync }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const pdfUrlRef = useRef<string | null>(null);
    const [log, setLog] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [retryToken, setRetryToken] = useState(0);
    const engineRef = useRef<PdfTeXEngineInstance | null>(null);
    const seqRef = useRef(0);
    const compileQueueRef = useRef<Promise<void>>(Promise.resolve());

    useImperativeHandle(ref, () => ({
      scrollToLine(_line: number) {
        // PDF embedded in iframe — line-level sync not yet supported.
        // Future: could use SyncTeX data from SwiftLaTeX.
      },
      getTargetLine(): number {
        return 0;
      },
      clearMark() {
        /* no-op for PDF view */
      },
    }));

    // Compile LaTeX → PDF via SwiftLaTeX WASM. Every compilation is queued
    // because the underlying worker and virtual filesystem are stateful.
    useEffect(() => {
      if (!value.trim()) {
        revokePdfUrl(pdfUrlRef, setPdfUrl);
        setLog(null);
        setError(null);
        return;
      }

      let cancelled = false;
      const run = async () => {
        const mySeq = ++seqRef.current;
        const compile = compileQueueRef.current.then(async () => {
          if (cancelled || mySeq !== seqRef.current) return;

          let cls: { new(): PdfTeXEngineInstance };
          try {
            cls = await getLatexEngineClass();
          } catch {
            if (!cancelled && mySeq === seqRef.current) {
              revokePdfUrl(pdfUrlRef, setPdfUrl);
              setError("Could not load LaTeX engine");
              setLoading(false);
            }
            return;
          }
          if (cancelled || mySeq !== seqRef.current) return;

          setLoading(true);
          setError(null);
          try {
            // Reuse the engine, but only after all previous compilations have
            // completed, so flushCache cannot race with compileLaTeX.
            if (!engineRef.current) {
              const loadedEngine: PdfTeXEngineInstance = new cls();
              // Keep the instance reachable before loadEngine() so the outer
              // catch can close a worker even when WASM initialization fails.
              engineRef.current = loadedEngine;
              await loadedEngine.loadEngine();
              if (cancelled || mySeq !== seqRef.current) {
                engineRef.current = null;
                loadedEngine.closeWorker();
                return;
              }
            }
            const eng = engineRef.current;
            eng.flushCache();
            eng.writeMemFSFile("main.tex", value);
            eng.setEngineMainFile("main.tex");

            let result = await eng.compileLaTeX();
            if (
              isMissingFormatError(result.status, result.log) &&
              !cancelled &&
              mySeq === seqRef.current
            ) {
              // Prefer the bundled/prebuilt format. Generate one only when
              // pdfTeX explicitly reports that it is missing.
              await eng.compileFormat();
              if (cancelled || mySeq !== seqRef.current) return;
              eng.flushCache();
              eng.writeMemFSFile("main.tex", value);
              eng.setEngineMainFile("main.tex");
              result = await eng.compileLaTeX();
            }
            if (cancelled || mySeq !== seqRef.current) return;

            setLog(result.log);
            if (result.status === 0 && result.pdf) {
              revokePdfUrl(pdfUrlRef, setPdfUrl);
              const blob = new Blob([result.pdf], { type: "application/pdf" });
              const url = URL.createObjectURL(blob);
              pdfUrlRef.current = url;
              setPdfUrl(url);
            } else {
              revokePdfUrl(pdfUrlRef, setPdfUrl);
              const msg = result.log || `Exit status ${result.status}`;
              setError(`${t("preview.latexError")} ${msg}`);
            }
            setLoading(false);
          } catch (e) {
            // A failed worker is not reusable: discard it so the next queued
            // compilation can create a clean engine instead of remaining in
            // the legacy engine's Error/Busy state.
            const failedEngine = engineRef.current;
            engineRef.current = null;
            failedEngine?.closeWorker();
            if (cancelled || mySeq !== seqRef.current) return;
            const message = e instanceof Error ? e.message : String(e);
            revokePdfUrl(pdfUrlRef, setPdfUrl);
            setError(`${t("preview.latexError")} ${message}`);
            setLoading(false);
          }
        });
        compileQueueRef.current = compile.catch(() => undefined);
        await compile;
      };

      const timer = window.setTimeout(() => {
        void run();
      }, 300); // slightly longer debounce — LaTeX is heavier than Markdown
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [value, t, retryToken]);

    // Cleanup blob URL and engine worker on unmount. Wait for the serialized
    // queue before closing the worker; otherwise an in-flight compile can be
    // left with a Promise that never settles and block later retries.
    useEffect(() => {
      return () => {
        revokePdfUrl(pdfUrlRef, setPdfUrl);
        const engine = engineRef.current;
        engineRef.current = null;
        void compileQueueRef.current.then(
          () => engine?.closeWorker(),
          () => engine?.closeWorker(),
        );
      };
    }, []);

    return (
      <div ref={containerRef} className="latex-preview">
        {loading && !pdfUrl && (
          <div className="typst-loading" role="status">
            <span className="typst-spinner" aria-hidden="true" />
            {t("preview.latexCompiling")}
          </div>
        )}

        {error && (
          <div className="preview-error" role="alert" aria-live="assertive">
            <strong>{t("preview.unavailable")}</strong>
            <p className="latex-notice-text">{t("preview.latexNotice")}</p>
            {log && <pre className="latex-log">{log}</pre>}
            <pre className="latex-log">{error}</pre>
            <button type="button" onClick={() => setRetryToken((t) => t + 1)}>
              {t("preview.retry")}
            </button>
          </div>
        )}

        {pdfUrl && (
          <iframe
            className="latex-iframe"
            src={pdfUrl}
            title="LaTeX PDF preview"
            sandbox="allow-scripts"
          />
        )}

        {!loading && !pdfUrl && !error && value.trim() && (
          <div className="latex-notice">
            <span className="latex-notice-icon" aria-hidden="true">📄</span>
            <span>{t("preview.latexNotice")}</span>
          </div>
        )}

        {!value.trim() && (
          <div className="latex-notice">
            <span>{t("preview.latexEmpty")}</span>
          </div>
        )}
      </div>
    );
  },
);

export default LatexPreview;
