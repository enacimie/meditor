/**
 * The fonts Typst gets from the application instead of from a CDN.
 *
 * The compiler tests run typst.ts's real `init` around a stand-in for its
 * WASM module, with `Function` refusing to evaluate `import(m)` the way a
 * Content-Security-Policy without 'unsafe-eval' does, and require the font
 * step to hand over all seventeen fonts anyway. The real WASM module evaluates
 * strings of its own when it starts, which is why it runs in a worker; that is
 * for the built run of tests/e2e/typst.spec.mjs, under the app's policy.
 */
// @ts-expect-error node:crypto and node:fs carry no types here: the src
// project is kept DOM-only on purpose (see pageSetup.test.ts).
import { createHash } from "node:crypto";
// @ts-expect-error as above.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resolveAssets } from "@myriaddreamin/typst.ts/dist/esm/options.init.mjs";
import { createTypstCompiler } from "@myriaddreamin/typst.ts/dist/esm/compiler.mjs";
import { TYPST_TEXT_FONTS, localFontLoader, typstFontUrls } from "./typstFonts";

const fontFile = (name: string) => new URL(`../public/typst-fonts/${name}`, import.meta.url);
const BASE = "https://app.example/meditor/";

describe("the fonts shipped with the application", () => {
  it("are exactly the set typst.ts would download", () => {
    const urls = _resolveAssets({ assets: ["text"], assetUrlPrefix: "x/" }) as string[];
    const names = urls.map((url) => url.slice("x/".length)).sort();
    expect([...TYPST_TEXT_FONTS].sort()).toEqual(names);
  });

  it("are all there, byte for byte, as released in typst-assets v0.13.1", () => {
    const listing: string = readFileSync(fontFile("SHA256SUMS"), "utf8");
    const sums = new Map(
      listing
        .trim()
        .split("\n")
        .map((line: string) => {
          const [hash, name] = line.trim().split(/\s+/);
          return [name, hash] as const;
        }),
    );
    let total = 0;
    for (const name of TYPST_TEXT_FONTS) {
      const bytes: Uint8Array = readFileSync(fontFile(name));
      total += bytes.length;
      const digest: string = createHash("sha256").update(bytes).digest("hex");
      expect(digest, name).toBe(sums.get(name));
    }
    // A font that is missing or damaged stops Typst for the whole session,
    // so the set is pinned to the release it came from.
    expect(total).toBe(8_713_432);
  });

  it("travel with their licences", () => {
    const notice: string = readFileSync(fontFile("NOTICE"), "utf8");
    expect(notice).toContain("SIL Open Font License");
    expect(notice).toContain("DejaVu");
    expect(notice).toContain("GUST Font License");
    const gust: string = readFileSync(fontFile("GUST-FONT-LICENSE.TXT"), "utf8");
    expect(gust).toContain("GUST");
  });

  it("are asked for beside the page, wherever the page is served", () => {
    expect(typstFontUrls(BASE)[0]).toBe(`${BASE}typst-fonts/${TYPST_TEXT_FONTS[0]}`);
    expect(typstFontUrls("tauri://localhost/")).toHaveLength(17);
    expect(typstFontUrls("tauri://localhost/").every((url) => url.startsWith("tauri://localhost/"))).toBe(true);
  });
});

describe("Typst's compiler under a policy that forbids evaluating strings", () => {
  const RealFunction = globalThis.Function;

  afterEach(() => {
    globalThis.Function = RealFunction;
    vi.restoreAllMocks();
  });

  /** What the desktop app's CSP does to `new Function('m', 'return import(m)')`. */
  function refuseEval() {
    globalThis.Function = new Proxy(RealFunction, {
      construct(target, args) {
        if (String(args[args.length - 1]).includes("import(")) {
          throw new EvalError("Refused to evaluate a string as JavaScript (unsafe-eval)");
        }
        return Reflect.construct(target, args);
      },
    });
  }

  /** The WASM module, stood in for: this is about the steps around it. */
  function fakeCompilerModule() {
    const fonts: Uint8Array[] = [];
    class TypstCompilerBuilder {
      async add_raw_font(font: Uint8Array) {
        fonts.push(font);
      }
      async build() {
        return { stand_in: true };
      }
    }
    return { fonts, module: { default: async () => {}, TypstCompilerBuilder } };
  }

  function fakeFetch(requested: string[]) {
    return (async (url: string) => {
      requested.push(url);
      return new Response(new Uint8Array([1, 2, 3, requested.length]));
    }) as unknown as typeof fetch;
  }

  it("still starts, with every font, and fetches nothing from outside the page", async () => {
    refuseEval();
    const { fonts, module } = fakeCompilerModule();
    const requested: string[] = [];
    const compiler = createTypstCompiler();

    await compiler.init({
      getWrapper: async () => module,
      getModule: () => new Uint8Array(),
      beforeBuild: [localFontLoader(() => typstFontUrls(BASE), fakeFetch(requested))],
    } as never);

    expect(fonts).toHaveLength(17);
    expect(requested).toHaveLength(17);
    expect(requested.every((url) => url.startsWith(`${BASE}typst-fonts/`))).toBe(true);
  });

  it("does not start with typst.ts's own loader, which is why this one exists", async () => {
    // The premise, checked rather than assumed: if this ever stops failing,
    // the library no longer evaluates strings and the local loader is no
    // longer the only way in.
    //
    // An empty `beforeBuild`, because that is what the application hands it:
    // the snippet always creates the list (`ccOptions.beforeBuild ||= []`),
    // and typst.ts adds its default loader to that list — to a copy it then
    // ignores when there is no list at all.
    refuseEval();
    const { module } = fakeCompilerModule();
    const compiler = createTypstCompiler();
    await expect(
      compiler.init({
        getWrapper: async () => module,
        getModule: () => new Uint8Array(),
        beforeBuild: [],
      } as never),
    ).rejects.toThrow(/unsafe-eval/);
  });

  it("names the font that could not be read", async () => {
    const { module } = fakeCompilerModule();
    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const compiler = createTypstCompiler();
    await expect(
      compiler.init({
        getWrapper: async () => module,
        getModule: () => new Uint8Array(),
        beforeBuild: [localFontLoader(() => typstFontUrls(BASE), missing)],
      } as never),
    ).rejects.toThrow(/DejaVuSansMono-Bold\.ttf could not be read \(404\)/);
  });
});
