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

The runner (`run.mjs`):

1. Starts `pnpm dev` if nothing is listening on `http://127.0.0.1:1420`.
2. Launches headless Chrome on a fresh profile + free CDP port.
3. Runs every `*.spec.mjs` in this directory, passing `CDP_PORT` and
   `BASE_URL` via the environment.
4. Tears down Chrome (and vite, if it started it).

## Writing a spec

```js
import { connect, assert } from "./cdp.mjs";

const page = await connect(Number(process.env.CDP_PORT));
try {
  await page.freshPage(process.env.BASE_URL ?? "http://127.0.0.1:1420");
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
| `launchChrome({ url, chromeBin, port })` | Spawn headless Chrome with remote debugging; returns `{ port, stop() }` |
| `connect(port)` | Attach to the page target; enables Runtime/Page and collects console errors |
| `page.evaluate(expr)` | Run JS in the page and return its value (throws on exceptions) |
| `page.waitFor(expr, opts)` | Poll until the expression is truthy (default 10s timeout) |
| `page.click(selector)` / `page.type(selector, text)` | Interact with the DOM; `type` uses the native value setter so React controlled inputs update |
| `page.text(selector)` / `page.exists(selector)` | Read DOM |
| `page.freshPage(url)` | Navigate, clear storage, reload |
| `page.screenshot(path)` | Save a PNG screenshot |
| `page.consoleErrors` | Collected console errors / uncaught exceptions |
| `assert(cond, msg)` | Fail-fast assertion (non-zero exit on failure) |

Screenshots are written to `tests/e2e/artifacts/` (gitignored).
