/**
 * E2E spec — the built app runs under the policy the desktop app enforces.
 *
 * Built run only (`pnpm test:e2e:built`), which serves dist/ through
 * preview-server.mjs. It proves the three things the guard stands on:
 *
 *   1. The page is served with the release policy: tauri.conf.json's, plus
 *      a hash for each inline script of dist/index.html, directive by
 *      directive — what Tauri itself would send.
 *   2. The app loads under it without a single violation, index.html's theme
 *      script included, which only gets through by its hash.
 *   3. The guard bites: an inline script injected into the page is refused
 *      and reported. Without this, a listener that had quietly stopped
 *      reporting would make every other spec look clean.
 *
 * Run via `pnpm test:e2e:built` (the runner sets CDP_PORT and BASE_URL).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, assert, sleep } from "./cdp.mjs";
import { parseCsp, releaseCsp } from "./tauri-csp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 30000 });

  // ── 1. The page carries the release policy ─────────────────────────────
  const expectedPolicy = releaseCsp(projectRoot);
  const served = await page.evaluate(
    `fetch(location.href, { cache: "no-store" }).then((r) => r.headers.get("content-security-policy"))`,
  );
  assert(served, "the built run served the page without a Content-Security-Policy");
  const expected = parseCsp(expectedPolicy);
  const actual = parseCsp(served);
  const differing = [...new Set([...expected.keys(), ...actual.keys()])].filter(
    (name) => (expected.get(name) ?? []).join(" ") !== (actual.get(name) ?? []).join(" "),
  );
  assert(
    differing.length === 0,
    `served policy differs in ${differing.join(", ")}:\n  served:   ${served}\n  expected: ${expectedPolicy}`,
  );
  const hashes = (actual.get("script-src") ?? []).filter((source) => source.startsWith("'sha256-"));
  assert(hashes.length >= 1, `script-src carries no hash for index.html's inline script: ${served}`);

  // ── 2. Nothing the app does on load is refused ─────────────────────────
  // A moment for the work that follows the editor: the preview's first
  // render, its fonts and images.
  await sleep(1500);
  assert(
    page.cspViolations.length === 0,
    `violations while loading: ${JSON.stringify(page.cspViolations)}`,
  );

  // ── 3. The guard bites ─────────────────────────────────────────────────
  await page.evaluate(`(() => {
    const probe = document.createElement("script");
    probe.textContent = "window.__cspProbe = 1";
    document.head.appendChild(probe);
    return true;
  })()`);
  let reported = null;
  for (let i = 0; i < 50 && !reported; i += 1) {
    reported = page.cspViolations.find(
      (violation) => violation.directive === "script-src-elem" && violation.blocked === "inline",
    );
    if (!reported) await sleep(100);
  }
  assert(
    reported,
    `an injected inline script was not reported: ${JSON.stringify(page.cspViolations)}`,
  );
  const ran = await page.evaluate("window.__cspProbe === 1");
  assert(!ran, "an injected inline script ran: the policy is not being enforced");
  // Provoked on purpose and checked above; anything else still fails on close.
  page.cspViolations.length = 0;

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `csp.spec ok — served the release policy (${hashes.length} inline hash), loaded clean, refused and reported an injected script`,
  );
} finally {
  page.close();
}
