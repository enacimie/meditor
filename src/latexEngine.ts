import { isMissingFormatError } from "./latexErrors";
// SwiftLaTeX WASM engine — lazy loader for PdfTeXEngine.
//
// PdfTeXEngine.js is a legacy UMD-style browser script. It is loaded as a
// same-origin classic script rather than fetched and evaluated with
// `new Function`, which keeps the Tauri CSP free of unsafe-eval.

interface CompileResult {
  pdf: Uint8Array | undefined;
  status: number;
  log: string;
}

interface PdfTeXEngineClass {
  new(): PdfTeXEngineInstance;
}

export interface PdfTeXEngineInstance {
  loadEngine(): Promise<void>;
  compileFormat(): Promise<void>;
  writeMemFSFile(filename: string, content: string | Uint8Array): void;
  setEngineMainFile(filename: string): void;
  compileLaTeX(): Promise<CompileResult>;
  flushCache(): void;
  closeWorker(): void;
}

type EngineWindow = Window & {
  __meditorPdfTeXEngine?: PdfTeXEngineClass;
  __meditorPdfTeXWorkerUrl?: string;
  __meditorTexliveEndpoint?: string;
};

export const DEFAULT_TEXLIVE_ENDPOINT = "https://texlive2.swiftlatex.com/";

export function normalizeTexliveEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_TEXLIVE_ENDPOINT;
  }
  const endpoint = value.trim();
  return endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
}

function configuredTexliveEndpoint(): string {
  return normalizeTexliveEndpoint(import.meta.env.VITE_TEXLIVE_ENDPOINT);
}

function getGlobalEngineClass(): PdfTeXEngineClass | undefined {
  return (window as EngineWindow).__meditorPdfTeXEngine;
}

let enginePromise: Promise<PdfTeXEngineClass> | null = null;

function loadEngineScript(): Promise<PdfTeXEngineClass> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("LaTeX engine requires a browser document"));
  }

  const engineWindow = window as EngineWindow;
  engineWindow.__meditorPdfTeXWorkerUrl = new URL(
    "swiftlatex/swiftlatexpdftex.js",
    document.baseURI,
  ).href;
  engineWindow.__meditorTexliveEndpoint = configuredTexliveEndpoint();
  const existing = getGlobalEngineClass();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = new URL("swiftlatex/PdfTeXEngine.js", document.baseURI).href;
    script.onload = () => {
      const loaded = getGlobalEngineClass();
      if (loaded) resolve(loaded);
      else reject(new Error("PdfTeXEngine.js did not expose PdfTeXEngine"));
    };
    script.onerror = () => reject(new Error("Failed to load PdfTeXEngine.js"));
    document.head.appendChild(script);
  });
}

export function getLatexEngineClass(): Promise<PdfTeXEngineClass> {
  if (!enginePromise) {
    enginePromise = loadEngineScript().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

/** One-shot compilation: LaTeX source → PDF Uint8Array. */
export async function compileLatexToPdf(source: string): Promise<Uint8Array> {
  const cls = await getLatexEngineClass();
  let lastResult: CompileResult | undefined;

  // A partially initialized legacy worker can lose its generated format file
  // after a transient WASM/TeX Live failure. Recreate it once rather than
  // surfacing a non-recoverable error to export.
  for (let attempt = 0; attempt < 2; attempt++) {
    const eng = new cls();
    try {
      await eng.loadEngine();
      eng.writeMemFSFile("main.tex", source);
      eng.setEngineMainFile("main.tex");
      let result = await eng.compileLaTeX();
      if (isMissingFormatError(result.status, result.log)) {
        // Most distributions provide a compatible precompiled format. Only
        // build one dynamically when the worker reports that it is absent.
        await eng.compileFormat();
        eng.flushCache();
        eng.writeMemFSFile("main.tex", source);
        eng.setEngineMainFile("main.tex");
        result = await eng.compileLaTeX();
      }
      if (result.status === 0 && result.pdf) return result.pdf;
      lastResult = result;
      if (!isMissingFormatError(result.status, result.log) || attempt === 1) break;
    } finally {
      eng.closeWorker();
    }
  }

  throw new Error(
    lastResult?.log || `Exit status ${lastResult?.status ?? "unknown"}`,
  );
}
