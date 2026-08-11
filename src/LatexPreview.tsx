import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { TranslationFn } from "./i18n/translations";
import "./Preview.css";

// ---- SwiftLaTeX lazy loader ----

interface CompileResult {
  pdf: Uint8Array | undefined;
  status: number;
  log: string;
}

interface PdfTeXEngineClass {
  new(): PdfTeXEngineInstance;
}

interface PdfTeXEngineInstance {
  loadEngine(): Promise<void>;
  writeMemFSFile(filename: string, content: string | Uint8Array): void;
  setEngineMainFile(filename: string): void;
  compileLaTeX(): Promise<CompileResult>;
  flushCache(): void;
  closeWorker(): void;
}

let enginePromise: Promise<PdfTeXEngineClass> | null = null;

const SWIFTLATEX_BASE = "/swiftlatex/";

async function fetchAndPatchEngine(): Promise<PdfTeXEngineClass> {
  const resp = await fetch(SWIFTLATEX_BASE + "PdfTeXEngine.js");
  if (!resp.ok) throw new Error(`Failed to load PdfTeXEngine.js: ${resp.status}`);
  let code = await resp.text();

  // Patch the hardcoded relative ENGINE_PATH to absolute URL so the Web Worker
  // can resolve swiftlatexpdftex.js (and its .wasm) from the correct origin.
  code = code.replace(
    "var ENGINE_PATH = 'swiftlatexpdftex.js'",
    `var ENGINE_PATH = '${SWIFTLATEX_BASE}swiftlatexpdftex.js'`,
  );

  // PdfTeXEngine.js is a UMD module that assigns to a local `exports` variable.
  // Execute it in a scoped Function so we can capture that exports object.
  const exports: Record<string, unknown> = {};
  new Function("exports", code)(exports);
  return exports.PdfTeXEngine as PdfTeXEngineClass;
}

function getLatexEngineClass(): Promise<PdfTeXEngineClass> {
  if (!enginePromise) {
    enginePromise = fetchAndPatchEngine()
      .then((cls) => cls)
      .catch((e) => {
        enginePromise = null; // allow retry
        throw e;
      });
  }
  return enginePromise;
}

/** One-shot compilation: LaTeX source → PDF Uint8Array. */
export async function compileLatexToPdf(source: string): Promise<Uint8Array> {
  const cls = await getLatexEngineClass();
  const eng = new cls();
  await eng.loadEngine();
  try {
    eng.writeMemFSFile("main.tex", source);
    eng.setEngineMainFile("main.tex");
    const result = await eng.compileLaTeX();
    if (result.status !== 0 || !result.pdf) {
      throw new Error(result.log || `Exit status ${result.status}`);
    }
    return result.pdf;
  } finally {
    eng.closeWorker();
  }
}

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

    // Compile LaTeX → PDF via SwiftLaTeX WASM
    useEffect(() => {
      if (!value.trim()) {
        setPdfUrl(null);
        setLog(null);
        setError(null);
        return;
      }

      let cancelled = false;
      const run = async () => {
        // Obtain engine class (lazy, cached across compilations)
        let cls: PdfTeXEngineClass;
        try {
          cls = await getLatexEngineClass();
        } catch {
          if (!cancelled) setError("Could not load LaTeX engine");
          return;
        }
        if (cancelled) return;

        setLoading(true);
        setError(null);
        seqRef.current++;
        const mySeq = seqRef.current;

        try {
          // Reuse the same engine instance across recompilations, just
          // flushing the virtual filesystem between runs.
          if (!engineRef.current) {
            const eng = new cls();
            await eng.loadEngine();
            engineRef.current = eng;
          }
          const eng = engineRef.current;
          eng.flushCache();
          eng.writeMemFSFile("main.tex", value);
          eng.setEngineMainFile("main.tex");

          const result = await eng.compileLaTeX();
          if (cancelled || mySeq !== seqRef.current) return;

          setLog(result.log);

          if (result.status === 0 && result.pdf) {
            // Revoke previous blob to avoid memory leaks
            if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
            const blob = new Blob([result.pdf], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            pdfUrlRef.current = url;
            setPdfUrl(url);
          } else {
            setPdfUrl(null);
            const msg = result.log || `Exit status ${result.status}`;
            setError(`${t("preview.latexError")} ${msg}`);
          }
          setLoading(false);
        } catch (e) {
          if (cancelled || mySeq !== seqRef.current) return;
          const message = e instanceof Error ? e.message : String(e);
          setError(`${t("preview.latexError")} ${message}`);
          setLoading(false);
        }
      };

      const timer = window.setTimeout(() => {
        void run();
      }, 300); // slightly longer debounce — LaTeX is heavier than Markdown
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [value, t, retryToken]);

    // Cleanup blob URL and engine worker on unmount
    useEffect(() => {
      return () => {
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        engineRef.current?.closeWorker();
        engineRef.current = null;
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
