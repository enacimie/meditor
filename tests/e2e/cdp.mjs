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

const CDP_READY_TIMEOUT_MS = 15000;
const SEND_TIMEOUT_MS = 20000;

/** Chrome binaries tried in order (override with `chromeBin`). */
const CHROME_BINARIES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
];

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

  const deadline = Date.now() + CDP_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
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
  throw new Error(`binary "${bin}" did not start within ${CDP_READY_TIMEOUT_MS}ms`);
}

/**
 * Connect to the first page target of a running Chrome instance.
 * Enables Runtime/Page and starts collecting console errors.
 *
 * @returns {Promise<CdpSession>}
 */
export async function connect(port) {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = targets.find((t) => t.type === "page") ?? null;
    } catch {
      // Endpoint not ready yet.
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error(`No page target found on CDP port ${port}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WebSocket connect failed"));
  });

  const session = new CdpSession(ws);
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
    this._id = 0;
    this._pending = new Map();
    this._listeners = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg);
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

  /** Evaluate a JS expression in the page and return its value. */
  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
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
   * Poll an expression until it is truthy. Throws on timeout.
   * @param {string} expression - JS expression returning a truthy value.
   */
  async waitFor(expression, { timeout = 10000, interval = 200, message } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.evaluate(expression)) return;
      await sleep(interval);
    }
    throw new Error(
      message ?? `waitFor timed out after ${timeout}ms: ${expression}`,
    );
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await sleep(300);
  }

  async reload() {
    await this.send("Page.reload", { ignoreCache: true });
    await sleep(300);
  }

  /**
   * Navigate to `url`, wait for the document to be fully loaded, then wipe
   * storage and reload (fresh app state). Waiting for readyState avoids
   * evaluating against a destroyed execution context mid-navigation.
   */
  async freshPage(url) {
    await this.navigate(url);
    await this.waitFor("document.readyState === 'complete'", { timeout: 15000 });
    await this.evaluate("localStorage.clear(); true");
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

  close() {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

/** Minimal assertion for spec files (exit code contract). */
export function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}
