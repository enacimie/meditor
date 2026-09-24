/// <reference types="vitest/config" />
import { defineConfig, type OutputChunk, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const MAX_INITIAL_CHUNK_BYTES = 1_750_000;

/**
 * What may never be in the first load, whatever it weighs.
 *
 * Typst's compiler and renderer run in their own worker (src/typstWorker.ts),
 * which is what lets them start under the desktop app's policy. Imported
 * statically from the page, typst.ts would be back in the first load, and a
 * call to it would run on the page, where that policy refuses what the
 * compiler evaluates when it starts. The byte budget would not notice: it has
 * the room.
 */
const NEVER_IN_THE_FIRST_LOAD = [
  { modules: "/node_modules/@myriaddreamin/", belongs: "in the Typst worker (src/typstWorker.ts)" },
];

function bundleBudgetPlugin(): Plugin {
  return {
    name: "meditor-bundle-budget",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (output): output is OutputChunk => output.type === "chunk",
      );
      const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

      /** What an entry loads before anything else: itself and its static imports. */
      function initialChunks(entry: OutputChunk): OutputChunk[] {
        const seen = new Map<string, OutputChunk>();
        const visit = (fileName: string) => {
          const chunk = byFileName.get(fileName);
          if (!chunk || seen.has(fileName)) return;
          seen.set(fileName, chunk);
          chunk.imports.forEach(visit);
        };
        visit(entry.fileName);
        return [...seen.values()];
      }

      for (const entry of chunks.filter((output) => output.isEntry)) {
        const initial = initialChunks(entry);
        const bytes = initial.reduce((total, chunk) => total + chunk.code.length, 0);
        if (bytes > MAX_INITIAL_CHUNK_BYTES) {
          this.error(
            `Initial bundle exceeds ${MAX_INITIAL_CHUNK_BYTES} bytes: ${entry.fileName} (${bytes} bytes including static imports)`,
          );
        }
        for (const rule of NEVER_IN_THE_FIRST_LOAD) {
          for (const chunk of initial) {
            const module = chunk.moduleIds.find((id) => id.includes(rule.modules));
            if (module) {
              const name = module.slice(module.lastIndexOf("/node_modules/") + "/node_modules/".length);
              this.error(
                `${name} is in the first load, in ${chunk.fileName} from ${entry.fileName}; it belongs ${rule.belongs}`,
              );
            }
          }
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Relative base enables file:// and offline usage (e.g. E2E tests).
  // Tauri's webview serves from a local server so relative paths work too.
  base: "./",
  plugins: [wasm(), react(), bundleBudgetPlugin()],

  /*
   * The version, from the one place that already has to be right.
   *
   * The About dialog asks Tauri for it at runtime, but there is no Tauri in a
   * browser, and meditor also ships as a web app — so it needs a value baked
   * in for that case. It used to be a hand-written constant, which meant every
   * `chore(release): bump` had to remember two more files. Nothing has ever
   * drifted, but only because nobody forgot yet.
   *
   * Defined rather than imported from the component, so the bundle carries the
   * string and not the rest of package.json.
   */
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    /*
     * Whether this build can actually check for updates.
     *
     * The updater needs a signing key, so it ships switched off behind
     * UPDATER_ENABLED and conf/updater-enabled.json. Off, `check()` finds no
     * endpoints and throws — and the menu entry offered it anyway, so every
     * user of such a build got a red "could not check" the first time they
     * tried. A control that can only fail is not an honest one; it should not
     * be there.
     *
     * Read from the same variable the workflow already exports, so the two
     * cannot disagree.
     */
    // @ts-expect-error process is a nodejs global
    __UPDATER_ENABLED__: JSON.stringify(process.env.UPDATER_ENABLED === "true"),
  },

  optimizeDeps: {
    // Prevent Vite from pre-bundling @myriaddreamin packages in dev mode.
    // These packages use .wasm?url imports internally, and the vite-plugin-wasm
    // plugin handles them. Pre-bundling would double-process and break WASM
    // resolution in the Vite 7 dev server.
    exclude: [
      "@myriaddreamin/typst.ts",
      "@myriaddreamin/typst-ts-web-compiler",
      "@myriaddreamin/typst-ts-renderer",
    ],
  },

  test: {
    environment: "node",
    /*
     * marp-core has to be transformed rather than loaded straight from
     * node_modules.
     *
     * Its ESM build does `import * as xss from "xss"` and then calls
     * `xss.friendlyAttrValue(...)` while sanitising attributes. `xss` is
     * CommonJS, and Node's lexer only recognises four of its named exports —
     * `friendlyAttrValue` is not among them — so under plain Node ESM that
     * call is `undefined` and sanitising any attribute throws. The browser
     * never sees this: Vite gives the package a real interop wrapper, which
     * is exactly what inlining asks for here.
     *
     * So the failure is a packaging quirk of the test environment, not of
     * meditor — but without this line the sanitising tests below fail on a
     * TypeError instead of on their assertions, which would hide whatever
     * they were meant to catch.
     */
    server: { deps: { inline: ["@marp-team/marp-core"] } },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      // Translation tables and sample documents are static data; their
      // structure is validated by dedicated parity tests rather than line
      // coverage. Excluding them makes the metric reflect executable logic.
      exclude: [
        "src/**/*.test.*",
        "src/test-setup.ts",
        "src/shims.d.ts",
        "src/i18n/translations/**/*.ts",
        "src/sample.ts",
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        statements: 50,
        branches: 40,
      },
    },
  },

  // The Typst worker (src/typstWorker.ts) is emitted as an ES module: its
  // module graph has dynamic imports, which Vite's default IIFE output for
  // workers cannot hold. Module workers are in WebView2, Android's WebView,
  // WebKitGTK, and WKWebView from Safari 15; macOS 10.13 and 10.14 cannot
  // have that, and there Typst does not start.
  worker: {
    format: "es",
  },

  build: {
    // Mermaid/paged.js remain lazy and can legitimately exceed Vite's
    // generic 500 kB warning. The custom plugin above protects the initial
    // application chunk instead of hiding all size regressions.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Keep heavyweight, lazy features out of the initial editor chunk.
        // WASM URLs and `?worker` assets are intentionally left to Vite's
        // native asset handling; only JavaScript modules are grouped here.
        manualChunks(id) {
          // Vite's helper for dynamic imports, on its own. The entry needs it,
          // and Rollup pulls the dependencies of a manual chunk into that
          // chunk: left alone it lands in whichever of the ones below uses it
          // first, and the entry then loads all of that chunk to reach it.
          // It sat in the Typst chunk until Typst moved into its worker; the
          // next in line was Mermaid, 3 MB, straight into the first load.
          if (id.includes("vite/preload-helper")) return "preload-helper";
          // Match the package directory itself, not similarly named
          // transitive dependencies (e.g. Mermaid's diagram definitions).
          // This keeps lazy feature chunks bounded while leaving workers,
          // WASM URLs and Rollup's shared-dependency analysis untouched.
          if (id.includes("/node_modules/@myriaddreamin/")) return "typst";
          if (id.includes("/node_modules/mermaid/")) return "mermaid";
          if (id.includes("/node_modules/pagedjs/")) return "pagedjs";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
