// SwiftLaTeX WASM engine — lazy loader for PdfTeXEngine.
//
// Extracted from LatexPreview.tsx so the component file only exports
// components (silencing react-refresh/only-export-components) and so
// App.tsx can import compileLatexToPdf() without dragging in JSX.

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

export function getLatexEngineClass(): Promise<PdfTeXEngineClass> {
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
