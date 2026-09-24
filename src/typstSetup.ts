import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import compilerWasm from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import { localFontLoader, typstFontUrls } from "./typstFonts";

let configured = false;

/**
 * typst.ts's snippet, set up once: its compiler and renderer from the WASM
 * this build packages, and the fonts served under `fontBase`.
 *
 * Runs in the Typst worker (typstWorker.ts), which is handed the page's
 * address with each request because it cannot see it.
 */
export function configureTypst(fontBase: string): typeof $typst {
  if (!configured) {
    configured = true;
    $typst.setCompilerInitOptions({
      getModule: () => compilerWasm,
      // The application's own copies of Typst's fonts, instead of typst.ts's
      // default loader, which evaluates a string and then downloads from a
      // CDN. See typstFonts.ts.
      beforeBuild: [localFontLoader(() => typstFontUrls(fontBase))],
    });
    $typst.setRendererInitOptions({
      getModule: () => rendererWasm,
    });
  }
  return $typst;
}
