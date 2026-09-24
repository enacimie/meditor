/**
 * The Typst compiler and renderer, in a worker of their own.
 *
 * The WASM compiler builds a few functions from strings when it starts
 * (wasm-bindgen's `new Function`), and the desktop app's Content-Security-
 * Policy refuses that to the page: `script-src` has 'wasm-unsafe-eval' and not
 * 'unsafe-eval', so in the installed app Typst never started. A dedicated
 * worker is governed by the policy of its own script, and Tauri sends a policy
 * with HTML documents only, so here the compiler can do what it needs while
 * the page, where the interface and the bridge to Rust live, keeps the policy
 * it has. Measured under the app's policy in WebKitGTK 2.50 and Chromium 153:
 * `new Function` refused on the page, allowed in a worker.
 */
import { configureTypst } from "./typstSetup";
import { serve, type TypstSnippet, type WorkerScope } from "./typstWorkerProtocol";

serve(self as unknown as WorkerScope, (request) => configureTypst(request.fontBase) as unknown as TypstSnippet);
