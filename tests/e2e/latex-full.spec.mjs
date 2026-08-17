/**
 * Opt-in E2E spec for the complete LaTeX pipeline.
 *
 * Unlike wasm.spec.mjs, this test requires the local TeX Live Ondemand
 * service. Run it with `pnpm test:e2e:latex` after starting Docker Compose.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("document.readyState === 'complete'", { timeout: 15000 });

  const result = await page.evaluate(`(async () => {
    let engine;
    try {
      const { getLatexEngineClass } = await import('/src/latexEngine.ts');
      const Engine = await getLatexEngineClass();
      const texliveEndpoint = window.__meditorTexliveEndpoint;
      engine = new Engine();
      await engine.loadEngine();
      const slash = String.fromCharCode(92);
      const source =
        slash + 'documentclass{article}\\n' +
        slash + 'begin{document}\\n' +
        'Hello from the complete LaTeX E2E test.\\n' +
        slash + 'end{document}\\n';
      const compileSource = () => {
        engine.writeMemFSFile('main.tex', source);
        engine.setEngineMainFile('main.tex');
        return engine.compileLaTeX();
      };
      let compile = await Promise.race([
        compileSource(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LaTeX compile timeout')), 150000),
        ),
      ]);
      if (
        compile?.status !== 0 &&
        /format file.*(?:can't find|not found)|can't find the format file/i.test(String(compile?.log ?? ''))
      ) {
        await engine.compileFormat();
        engine.flushCache();
        compile = await Promise.race([
          compileSource(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('LaTeX compile timeout after format')), 150000),
          ),
        ]);
      }
      const pdf = compile?.pdf;
      return {
        ok: true,
        texliveEndpoint,
        status: compile?.status,
        log: String(compile?.log ?? '').slice(0, 1000),
        pdfLength: pdf?.length ?? 0,
        signature: pdf ? [...pdf.slice(0, 5)] : [],
      };
    } catch (error) {
      return {
        ok: false,
        texliveEndpoint: window.__meditorTexliveEndpoint,
        error: String(error),
      };
    } finally {
      try { engine?.closeWorker(); } catch { /* best effort */ }
    }
  })()`, 175000);

  assert(result?.ok, `LaTeX pipeline threw: ${result?.error ?? "unknown error"}`);
  assert(
    result.texliveEndpoint === "http://127.0.0.1:5000/",
    `unexpected TeX Live endpoint: ${result.texliveEndpoint}`,
  );
  assert(result.status === 0, `LaTeX exited with status ${result.status}: ${result.log}`);
  assert(result.pdfLength > 5, "LaTeX should return a non-empty PDF");
  assert(
    JSON.stringify(result.signature) === JSON.stringify([37, 80, 68, 70, 45]),
    `invalid PDF signature: ${JSON.stringify(result.signature)}`,
  );
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `PASS: latex-full.spec — PDF ${result.pdfLength} bytes, status ${result.status}`,
  );
} finally {
  page.close();
}
