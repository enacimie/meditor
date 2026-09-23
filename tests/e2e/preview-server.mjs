/**
 * `vite preview` of `dist/`, sending the Content-Security-Policy the desktop
 * app runs under.
 *
 * The built E2E run exists because the development server is not what anybody
 * installs; the policy is the other half of that difference. Twice now a
 * feature worked everywhere the tests looked and failed only in the packaged
 * app, because only the packaged app enforces this policy: the Typst WASM
 * (c153f4d, `wasm-unsafe-eval`) and Typst's font loader (`unsafe-eval`).
 *
 * The header goes on what Tauri sends it with, HTML: the page itself and the
 * single-page fallback for paths without an extension. Scripts, styles and
 * workers load without one, as they do in the app.
 *
 * Usage: node tests/e2e/preview-server.mjs --port 4173
 */
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { releaseCsp } from "./tauri-csp.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag === -1 ? NaN : process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("usage: node tests/e2e/preview-server.mjs --port <port>");
}

// Read once, before serving: the build is not supposed to change under a run.
const policy = releaseCsp(projectRoot);

function isDocument(url) {
  const path = (url ?? "/").split("?")[0];
  return path.endsWith("/") || path.endsWith(".html") || extname(path) === "";
}

const server = await preview({
  root: projectRoot,
  preview: { port, strictPort: true },
  plugins: [
    {
      name: "meditor-release-csp",
      configurePreviewServer(previewServer) {
        // Registered before Vite's own static handler, so the header is set
        // before anything is written.
        previewServer.middlewares.use((req, res, next) => {
          if (isDocument(req.url)) res.setHeader("Content-Security-Policy", policy);
          next();
        });
      },
    },
  ],
});
server.printUrls();
console.log("[preview] serving dist/ under the release Content-Security-Policy");
