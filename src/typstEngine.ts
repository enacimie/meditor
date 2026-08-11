// Typst WASM engine — lazy loader for @myriaddreamin/typst.ts.
//
// Extracted from TypstPreview.tsx so the component file only exports
// components (silencing react-refresh/only-export-components) and so
// App.tsx can import getTypst() without dragging in JSX.
//
// The all-in-one.mjs side-import sets up $typst.setRendererInitOptions() and
// $typst.setCompilerInitOptions() with browser WASM module URLs.  Without
// this the typst-ts-renderer wasm-pack-shim only loads WASM in Node.js and
// the browser gets "Cannot import wasm module without importer".
// We use a Function-constructor dynamic import to prevent Rollup from
// trying to resolve all-in-one.mjs internal relative paths at build time.

let typstModule: Promise<typeof import("@myriaddreamin/typst.ts")> | null = null;

export function getTypst() {
  if (!typstModule) {
    typstModule = import("@myriaddreamin/typst.ts")
      .then(async (mod) => {
        // Side-effect: wire up browser WASM module URLs so the renderer
        // can load typst_ts_renderer_bg.wasm at runtime.
        const dynamicImport = new Function("p", "return import(p)") as (
          p: string,
        ) => Promise<unknown>;
        await dynamicImport(
          "@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one.mjs",
        );
        return mod;
      })
      .catch((e) => {
        typstModule = null; // allow retry
        throw e;
      });
  }
  return typstModule;
}
