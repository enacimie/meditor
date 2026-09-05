/**
 * Reusable headless-Chrome CDP driver for E2E tests.
 *
 * Zero dependencies: uses Node's built-in `fetch` and `WebSocket` (Node ≥ 21).
 * The browser-use agent is flaky in this environment, so this driver drives a
 * real headless Chrome over the Chrome DevTools Protocol instead.
 *
 * Usage:
 *   import { launchChrome, connect, assert, sleep } from "./cdp.mjs";
 *   const chrome = await launchChrome({ url: "http://127.0.0.1:1420" });
 *   const page = await connect(chrome.port);
 *   await page.waitFor("!!document.querySelector('.cm-content')");
 *   await page.click(".tab-add");
 *   ...
 *   page.close();
 *   chrome.stop();
 *
 * Specs run as standalone scripts; the runner passes CDP_PORT and BASE_URL
 * via the environment (see run.mjs).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors that mean "the page moved on", not "the test is wrong": Chrome throws
 * these when the execution context is swapped while an evaluation is in
 * flight, which happens on reloads and during heavy startup work (loading the
 * Typst/LaTeX WASM, for instance). They are worth retrying, never worth
 * failing on.
 */
/** One readable line of an expression, for an error message. */
function summarise(expression) {
  const line = String(expression).replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function isTransientEvaluationError(error) {
  const message = String(error?.message ?? error);
  return (
    message.includes("Promise was collected") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context") ||
    message.includes("Inspected target navigated or closed")
  );
}

const CDP_READY_TIMEOUT_MS = 15000;
const SEND_TIMEOUT_MS = 20000;
/*
 * Navigation gets its own, longer budget. The specs run against the Vite dev
 * server, which compiles the module graph on demand, so the first hit of a run
 * is far slower than any later command — enough to blow past SEND_TIMEOUT_MS on
 * a cold CI runner, which is exactly how contrast.spec (the first spec to run,
 * alphabetically) failed with "CDP command timed out: Page.navigate".
 */
const NAVIGATION_TIMEOUT_MS = 60000;

/**
 * Chrome binaries tried in order (override with `chromeBin` or CHROME_PATH).
 * Windows installs Chrome outside PATH, so the usual install paths are tried
 * as well; `%LOCALAPPDATA%` covers per-user installs and Edge is a Chromium
 * that speaks the same DevTools protocol.
 */
const CHROME_BINARIES = [
  process.env.CHROME_PATH,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
  ...(process.platform === "win32"
    ? [
        join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
      ]
    : []),
  ...(process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    : []),
].filter(Boolean);

/** Find a free TCP port on 127.0.0.1 (avoids conflicts with other runs). */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Launch headless Chrome with remote debugging on an ephemeral profile.
 * Tries a list of known Chrome binaries when `chromeBin` is not given.
 *
 * @returns {{ port: number, stop: () => void }}
 */
export async function launchChrome({ url, chromeBin, port } = {}) {
  const cdpPort = port ?? (await findFreePort());
  const candidates = chromeBin ? [chromeBin] : CHROME_BINARIES;
  let lastError = null;
  for (const bin of candidates) {
    try {
      return await startWith(bin, cdpPort, url);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not launch Chrome (tried ${candidates.join(", ")}): ` +
      (lastError?.message ?? "unknown error"),
  );
}

async function startWith(bin, cdpPort, url) {
  const profileDir = mkdtempSync(join(tmpdir(), "meditor-e2e-"));
  const chrome = spawn(
    bin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      url ?? "about:blank",
    ],
    { stdio: "ignore" },
  );

  // spawn() reports a missing binary asynchronously, so without this handler a
  // candidate that is not installed raises an unhandled 'error' event and kills
  // the runner before the remaining candidates are tried.
  let spawnError = null;
  chrome.on("error", (error) => {
    spawnError = error;
  });

  const deadline = Date.now() + CDP_READY_TIMEOUT_MS;
  while (Date.now() < deadline && !spawnError) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        return {
          port: cdpPort,
          profileDir,
          stop() {
            chrome.kill("SIGKILL");
            try {
              rmSync(profileDir, { recursive: true, force: true });
            } catch {
              // Profile removal can race with Chrome's shutdown — not fatal.
            }
          },
        };
      }
    } catch {
      // Chrome is still starting up.
    }
    await sleep(250);
  }
  chrome.kill("SIGKILL");
  rmSync(profileDir, { recursive: true, force: true });
  if (spawnError) {
    throw new Error(`binary "${bin}" could not be started: ${spawnError.message}`);
  }
  throw new Error(`binary "${bin}" did not start within ${CDP_READY_TIMEOUT_MS}ms`);
}

/**
 * Connect to the first page target of a running Chrome instance.
 * Enables Runtime/Page and starts collecting console errors.
 *
 * @returns {Promise<CdpSession>}
 */
export async function connect(port) {
  // Always create a brand-new page target instead of attaching to whatever
  // is lying around: Page.addScriptToEvaluateOnNewDocument registrations
  // (the Tauri shim some specs install) live on the *target* and would
  // silently leak into every later spec reusing it.
  let created = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: "PUT",
    });
    if (res.ok) created = await res.json();
  } catch {
    // Fall through to discovery below.
  }

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pages = targets.filter((t) => t.type === "page");
      target =
        (created && pages.find((t) => t.id === created.id)) ??
        pages.find((t) => t.url === "about:blank") ??
        null;
    } catch {
      // Endpoint not ready yet.
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("No page target found on CDP port");

  // Exclusive access: any *other* live page of this browser is a leftover
  // from an earlier spec that never closed it — a live React instance whose
  // debounced session writer keeps mutating the shared localStorage and
  // poisons whatever this spec tries to observe. Sweep them.
  try {
    const all = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    for (const t of all) {
      if (t.type === "page" && t.id !== target.id) {
        await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {});
      }
    }
  } catch {
    // Listing failed; proceed — the sweep is best-effort hygiene.
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WebSocket connect failed"));
  });

  const session = new CdpSession(ws);
  session.targetId = target.id;
  session.onMessage((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params?.exceptionDetails;
      session.consoleErrors.push(
        "EXCEPTION: " +
          JSON.stringify(detail?.exception?.description ?? detail?.text ?? detail),
      );
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      session.consoleErrors.push(
        "CONSOLE.ERROR: " +
          msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
      );
    }
  });
  await session.send("Runtime.enable");
  await session.send("Page.enable");
  return session;
}

/**
 * Minimal CDP session bound to one page.
 * Every method is a thin wrapper over Runtime/Page commands.
 */
export class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.consoleErrors = [];
    /** How many reads were retried past a transient error, for reporting. */
    this.transientReads = 0;
    this._id = 0;
    this._pending = new Map();
    this._listeners = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject, method } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(`${msg.error.message} (${msg.error.code}) in ${method}`));
        } else resolve(msg);
        return;
      }
      for (const listener of this._listeners) {
        try {
          listener(msg);
        } catch (error) {
          console.error("[cdp] listener error:", error);
        }
      }
    };
  }

  /** Register a raw CDP message listener. */
  onMessage(listener) {
    this._listeners.push(listener);
  }

  /**
   * Inject `source` into every document before any page script runs
   * (e.g. the Tauri backend shim). Registered once per page target; the
   * runner's Chrome starts on about:blank, so call this right after connect.
   * Returns the script identifier so specs can remove it on teardown
   * (required when the shim must not leak into later specs).
   */
  async addInitScript(source) {
    const res = await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source,
    });
    return res.result?.identifier;
  }

  /** Remove a previously registered init script by its identifier. */
  async removeInitScript(identifier) {
    if (identifier === undefined) return;
    await this.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier,
    });
  }

  /** Send a raw CDP command; rejects after SEND_TIMEOUT_MS. */
  send(method, params = {}, timeoutMs = SEND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP command timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this._pending.set(id, {
        method,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate a JS expression in the page and return its value.
   *
   * If the expression sets its own deadline, pass a `timeoutMs` above it.
   * Otherwise this command gives up first and the page-side promise is left
   * running, which Chrome later reports as "Promise was collected" — a
   * confusing way to be told the budgets disagree.
   *
   * @param {string} expression
   * @param {number} [timeoutMs] - must exceed any timeout inside `expression`.
   */
  async evaluate(expression, timeoutMs = SEND_TIMEOUT_MS) {
    let res;
    try {
      res = await this.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }, timeoutMs);
    } catch (error) {
      // Say which evaluation it was. `Promise was collected` has taken down
      // five CI runs, and every time the error named neither the command nor
      // the expression, so which call had failed had to be reasoned out from
      // the timestamps. The message keeps its original wording at the front,
      // because `isTransientEvaluationError` and one spec both match on it.
      error.message = `${error.message} — evaluating: ${summarise(expression)}`;
      throw error;
    }
    if (res.result?.exceptionDetails) {
      const detail = res.result.exceptionDetails;
      throw new Error(
        "JS exception: " +
          (detail.exception?.description ?? detail.text ?? JSON.stringify(detail)),
      );
    }
    return res.result?.result?.value;
  }

  /**
   * Evaluate something safe to run more than once, retrying the errors that
   * mean "the page moved on".
   *
   * `evaluate` cannot do this on its own. Most of what specs evaluate has side
   * effects — a click, a keystroke, a document replaced — and running one of
   * those twice because the first attempt reported a collected promise would
   * be worse than the failure. So retrying is opt-in, and the opting-in is the
   * caller saying "running this again changes nothing".
   *
   * @param {string} expression - must be safe to evaluate more than once.
   */
  async evaluateRepeatable(expression, { attempts = 4, delay = 150 } = {}) {
    let lastTransient;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.evaluate(expression);
      } catch (error) {
        if (!isTransientEvaluationError(error)) throw error;
        lastTransient = error;
        this.transientReads++;
        await sleep(delay);
      }
    }
    throw new Error(
      `read gave up after ${attempts} attempts: ${expression} ` +
        `(last transient error: ${lastTransient?.message})`,
    );
  }

  /**
   * Evaluate a read-only expression, retrying the errors that mean "the page
   * moved on". A read changes nothing, so it is always safe to repeat.
   *
   * This is the shape the retry exists for: `wasm.spec` waits a minute for a
   * WASM engine to load and then reads the result out of the page, and that
   * read has failed on Windows CI with `Promise was collected`.
   *
   * @param {string} expression - must not change anything.
   */
  read(expression, options) {
    return this.evaluateRepeatable(expression, options);
  }

  /**
   * Poll an expression until it is truthy. Throws on timeout.
   * @param {string} expression - JS expression returning a truthy value.
   */
  async waitFor(expression, { timeout = 10000, interval = 200, message } = {}) {
    const start = Date.now();
    let lastTransient = null;
    while (Date.now() - start < timeout) {
      try {
        if (await this.evaluate(expression)) return;
      } catch (error) {
        // While the page is (re)loading, the execution context can be replaced
        // mid-evaluation. That is exactly the state waitFor exists to wait
        // through, so keep polling instead of failing. Real errors — a typo in
        // the expression, an exception in the page — still propagate.
        if (!isTransientEvaluationError(error)) throw error;
        lastTransient = error;
      }
      await sleep(interval);
    }
    throw new Error(
      (message ?? `waitFor timed out after ${timeout}ms: ${expression}`) +
        (lastTransient ? ` (last transient error: ${lastTransient.message})` : ""),
    );
  }

  async navigate(url) {
    await this.send("Page.navigate", { url }, NAVIGATION_TIMEOUT_MS);
    await sleep(300);
  }

  async reload() {
    await this.send("Page.reload", { ignoreCache: true }, NAVIGATION_TIMEOUT_MS);
    await sleep(300);
  }

  /**
   * Navigate to `url`, wait for the document to be fully loaded, then wipe
   * storage and reload (fresh app state). Waiting for readyState avoids
   * evaluating against a destroyed execution context mid-navigation.
   *
   * The wipe runs twice on purpose: the boot this interrupts schedules its
   * own debounced session write (~500 ms), which would otherwise land after
   * the first clear and re-seed storage before the reload commits.
   */
  async freshPage(url) {
    await this.navigate(url);
    await this.waitFor("document.readyState === 'complete'", { timeout: 15000 });
    // Repeatable rather than plain: this runs while the page is still
    // settling from a navigation, which is when the execution context gets
    // replaced under an evaluation. Clearing storage twice is already what
    // this method does on purpose, so a third time costs nothing — whereas
    // the whole spec run dying because the context blinked costs a CI job.
    await this.evaluateRepeatable("localStorage.clear(); true");
    await sleep(700);
    await this.evaluateRepeatable("localStorage.clear(); true");
    await this.reload();
  }

  /** Capture a full-page PNG screenshot to `path`. */
  async screenshot(path) {
    const shot = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(shot.result.data, "base64"));
  }

  /** Click the first element matching `selector` (throws if missing). */
  async click(selector) {
    const ok = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    );
    if (!ok) throw new Error(`click: no element for ${selector}`);
  }

  /**
   * Set the value of an input/textarea and dispatch `input` (React's
   * controlled components) plus `change` (CodeMirror's search panel listens
   * to onchange/onkeyup, not input). Uses the native value setter trick.
   */
  async type(selector, text) {
    const ok = await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );
    if (!ok) throw new Error(`type: no element for ${selector}`);
  }

  /** Return the textContent of the first element matching `selector`. */
  async text(selector) {
    return this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`,
    );
  }

  /** Whether an element matching `selector` exists. */
  async exists(selector) {
    return this.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  }

  /**
   * Close the page target, not just this socket.
   *
   * Closing the WebSocket alone left every previous spec's page alive in the
   * shared browser: live React instances kept writing the shared localStorage
   * and later specs read their leftovers. Closing the target makes each spec
   * leave nothing behind; `connect` recreates a blank page on demand.
   */
  close() {
    if (this._closed) return;
    this._closed = true;
    const finish = () => {
      try {
        this.ws.close();
      } catch {
        // Already closed.
      }
    };
    try {
      const id = ++this._id;
      const onAck = (msg) => {
        if (msg.id === id) {
          this._listeners = this._listeners.filter((l) => l !== onAck);
          finish();
        }
      };
      this.onMessage(onAck);
      this.ws.send(
        JSON.stringify({
          id,
          method: "Target.closeTarget",
          params: { targetId: this.targetId },
        }),
      );
      // The ack must never be what keeps the process hanging.
      setTimeout(finish, 500);
    } catch {
      finish();
    }
  }
}

/** Minimal assertion for spec files (exit code contract). */
export function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}
