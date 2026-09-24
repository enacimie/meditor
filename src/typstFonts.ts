/**
 * Typst's default fonts, served by the application itself.
 *
 * By default typst.ts fetches these seventeen files from a CDN, and it does it
 * through `ComponentBuilder.loadFonts`, which starts with
 * `new Function('m', 'return import(m)')`. Without a network Typst never
 * started, and under a Content-Security-Policy without 'unsafe-eval' the font
 * step alone was enough to stop it.
 *
 * These are the same files, from typst-assets v0.13.1 (the version typst.ts
 * points its CDN at), shipped in `public/typst-fonts` with their licences and
 * handed to the compiler's builder directly: loading them fetches nothing from
 * outside the application and evaluates nothing. (The WASM compiler also
 * builds a few functions from strings of its own when it starts, which no font
 * loader can change: that is why it runs in a worker, typstWorker.ts.)
 */
import type { BeforeBuildFn } from "@myriaddreamin/typst.ts/dist/esm/options.init.mjs";

/** The "text" asset set typst.ts would otherwise download, by file name. */
export const TYPST_TEXT_FONTS = [
  "DejaVuSansMono-Bold.ttf",
  "DejaVuSansMono-BoldOblique.ttf",
  "DejaVuSansMono-Oblique.ttf",
  "DejaVuSansMono.ttf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-BoldItalic.otf",
  "LibertinusSerif-Italic.otf",
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Semibold.otf",
  "LibertinusSerif-SemiboldItalic.otf",
  "NewCM10-Bold.otf",
  "NewCM10-BoldItalic.otf",
  "NewCM10-Italic.otf",
  "NewCM10-Regular.otf",
  "NewCMMath-Bold.otf",
  "NewCMMath-Book.otf",
  "NewCMMath-Regular.otf",
] as const;

/**
 * Where the application serves them. Relative to the page, like every other
 * asset (`base: "./"`), so the same list works in the desktop app, under the
 * web build's sub-path and on the development server.
 */
export function typstFontUrls(base: string = document.baseURI): string[] {
  return TYPST_TEXT_FONTS.map((name) => new URL(`typst-fonts/${name}`, base).href);
}

interface FontBuilder {
  add_raw_font(font: Uint8Array): Promise<void> | void;
}

/**
 * A `beforeBuild` step that loads the fonts and adds them to the builder.
 *
 * The two properties are what typst.ts reads before it builds
 * (`compiler.mjs`, `TypstCompilerDriver.init`): `_kind` says a font loader is
 * present, so it does not refuse to build; `_preloadRemoteFontOptions` with
 * `assets: false` says remote assets are off, so it does not add its own
 * loader — the one that would evaluate a string and then go to the CDN.
 * Both are internal to typst.ts, which is why a test runs its real `init`.
 */
export function localFontLoader(
  urls: () => string[],
  fetchFont: typeof fetch = fetch,
): BeforeBuildFn & { _kind: "fontLoader"; _preloadRemoteFontOptions: { assets: false } } {
  const loader = async (_stage: unknown, { builder }: { builder: FontBuilder }) => {
    const fonts = await Promise.all(
      urls().map(async (url) => {
        const response = await fetchFont(url);
        if (!response.ok) {
          // Name the file: a font that cannot be read leaves Typst unable to
          // start for the rest of the session, and "failed" would not say why.
          throw new Error(`Typst font ${url.split("/").pop()} could not be read (${response.status})`);
        }
        return new Uint8Array(await response.arrayBuffer());
      }),
    );
    for (const font of fonts) await builder.add_raw_font(font);
  };
  return Object.assign(loader, {
    _kind: "fontLoader" as const,
    _preloadRemoteFontOptions: { assets: false as const },
  });
}
