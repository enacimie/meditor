import { $typst, TypstSnippet } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import compilerWasm from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import { localFontLoader, typstFontUrls } from "./typstFonts";

let configured = false;

/**
 * What a document's `#import "@preview/…"` gets told.
 *
 * typst.ts's default in a browser is a registry that downloads the package
 * from packages.typst.org at compile time and hands it to the compiler —
 * opening somebody's `.typ` would become a network request and a run of
 * third-party code, in an editor that otherwise ships its fonts and its
 * WASM with the build and asks the network for nothing. This registry
 * refuses instead, and the import becomes a compile error that says why.
 */
const OFFLINE_MESSAGE =
  "meditor compiles offline: package registry imports (@preview/…) are not available";

const offlineRegistry = {
  resolvePath(): never {
    throw new Error(OFFLINE_MESSAGE);
  },
  pullPackageData(): never {
    throw new Error(OFFLINE_MESSAGE);
  },
  resolve(): never {
    throw new Error(OFFLINE_MESSAGE);
  },
};

/**
 * typst.ts's snippet, set up once: its compiler and renderer from the WASM
 * this build packages, the fonts served under `fontBase`, and no package
 * registry but the refusing one above.
 *
 * Runs in the Typst worker (typstWorker.ts), which is handed the page's
 * address with each request because it cannot see it. The first request's
 * `fontBase` is the one that sticks; every request in a run comes from the
 * same page, so there is nothing to reconfigure.
 */
export function configureTypst(fontBase: string): typeof $typst {
  if (!configured) {
    configured = true;
    // Before the init options: the providers registered here are read when
    // the compiler instance is first built, which the options then feed.
    $typst.use(
      TypstSnippet.withPackageRegistry(
        offlineRegistry as unknown as Parameters<typeof TypstSnippet.withPackageRegistry>[0],
      ),
    );
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
