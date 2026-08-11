/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Relative base enables file:// and offline usage (e.g. E2E tests).
  // Tauri's webview serves from a local server so relative paths work too.
  base: "./",
  plugins: [wasm(), react()],

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

  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mermaid: ["mermaid"],
          pagedjs: ["pagedjs"],
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
