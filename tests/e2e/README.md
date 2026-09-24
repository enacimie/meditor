# E2E tests (headless Chrome via CDP)

Browser-level verification of the app's real UI. Because the browser-use
agent has been unreliable in this environment, these tests drive headless
Chrome directly over the Chrome DevTools Protocol with **zero dependencies**
(Node ≥ 21 built-in `fetch` + `WebSocket`).

## Run

```bash
pnpm test:e2e

# Requires Docker + the local TeX Live service.
# This suite requires port 1420 to be free so its endpoint env is isolated.
pnpm test:e2e:latex
```

Set `E2E_SPECS` to a comma-separated list of spec filenames to run only a
subset, as the opt-in LaTeX workflow does with `latex-full.spec.mjs`.

`pnpm test:e2e:built` builds the app and serves `dist/` instead
(`preview-server.mjs`), under the Content-Security-Policy the desktop app
runs under: `tauri.conf.json`'s, plus the `'sha256-…'` of each inline script,
which Tauri adds when it embeds the frontend (`tauri-csp.mjs`). The driver
collects every violation a page reports and fails the spec on `close()`;
`csp.spec.mjs`, which only runs there, proves the policy is served and that a
violation is caught. `typst.spec.mjs` runs there too: Typst's compiler works
in a worker because the page's policy refuses what its WASM evaluates when it
starts, and only the built run can show that it still does. It refuses to
reuse a server that is already running.

The runner (`run.mjs`):

1. Starts vite if nothing is already serving the app. It probes
   `http://localhost:1420`, `http://127.0.0.1:1420` and `http://[::1]:1420`,
   because vite binds to `localhost` — which resolves to `::1` on most systems,
   so an IPv4-only check reports a healthy server as missing.
2. Launches headless Chrome on a fresh profile + free CDP port.
3. Runs the `*.spec.mjs` in this directory, passing `CDP_PORT` and
   `BASE_URL` via the environment: all of them except `latex-full` (opt-in)
   and `csp` (built run only), unless `E2E_SPECS` or `--built` choose.
4. Tears down Chrome (and vite, if it started it).

`BASE_URL` overrides the probing altogether; `E2E_PORT` and
`E2E_STARTUP_TIMEOUT_MS` (default 60000) tune the defaults.

## Writing a spec

```js
import { connect, assert } from "./cdp.mjs";

const page = await connect(Number(process.env.CDP_PORT));
try {
  await page.freshPage(process.env.BASE_URL ?? "http://localhost:1420");
  await page.waitFor("!!document.querySelector('.cm-content')");
  await page.click(".tab-add");
  assert(await page.exists(".tabbar"), "tab bar visible");
} finally {
  page.close();
}
```

## Driver API (`cdp.mjs`)

| Member | Purpose |
| ------ | ------- |
| `launchChrome({ url, chromeBin, port })` | Spawn headless Chrome with remote debugging; returns `{ port, profileDir, stop() }`, and `stop()` resolves once Chrome has exited and its profile is gone |
| `connect(port)` | Attach to the page target; enables Runtime/Page, collects console errors and Content-Security-Policy violations (`page.cspViolations`, which fail the spec on `close()`) |
| `page.evaluate(expr)` | Run JS in the page and return its value (throws on exceptions) |
| `page.waitFor(expr, opts)` | Poll until the expression is truthy (default 10s timeout) |
| `page.click(selector)` / `page.type(selector, text)` | Interact with the DOM; `type` uses the native value setter so React controlled inputs update |
| `page.text(selector)` / `page.exists(selector)` | Read DOM |
| `page.freshPage(url)` | Navigate, clear storage, reload |
| `page.screenshot(path)` | Save a PNG screenshot |
| `page.consoleErrors` | Collected console errors / uncaught exceptions |
| `assert(cond, msg)` | Fail-fast assertion (non-zero exit on failure) |

Screenshots are written to `tests/e2e/artifacts/` (gitignored).
