import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import compilerWasm from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";

$typst.setCompilerInitOptions({
  getModule: () => compilerWasm,
});
$typst.setRendererInitOptions({
  getModule: () => rendererWasm,
});

export { $typst };
