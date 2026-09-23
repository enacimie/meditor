import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import compilerWasm from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import { localFontLoader, typstFontUrls } from "./typstFonts";

$typst.setCompilerInitOptions({
  getModule: () => compilerWasm,
  // The application's own copies of Typst's fonts, instead of typst.ts's
  // default loader: that one evaluates a string, which the desktop app's
  // policy refuses, and then downloads from a CDN. See typstFonts.ts.
  beforeBuild: [localFontLoader(() => typstFontUrls())],
});
$typst.setRendererInitOptions({
  getModule: () => rendererWasm,
});

export { $typst };
