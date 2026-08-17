/**
 * E2E test runner.
 *
 * Orchestrates the whole flow so specs only care about the page:
 *   1. Starts `pnpm dev` (vite) if nothing is already listening on BASE_URL.
 *   2. Launches headless Chrome (fresh profile, free CDP port).
 *   3. Runs every `*.spec.mjs` in this directory as a child process, passing
 *      CDP_PORT and BASE_URL via the environment.
 *   4. Tears down Chrome (and vite, if this runner started it) — even when a
 *      spec fails, Chrome fails to launch, or the user presses Ctrl+C.
 *
 * Usage: pnpm test:e2e   (or: node tests/e2e/run.mjs)
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./cdp.mjs";

if (process.argv.includes("--latex")) {
  process.env.E2E_REQUIRE_FRESH_SERVER = "1";
  process.env.E2E_SPECS = "latex-full.spec.mjs";
  process.env.VITE_TEXLIVE_ENDPOINT ??= "http://127.0.0.1:5000/";
}

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:1420";
const SPEC_TIMEOUT_MS = 180_000;
const specsDir = dirname(fileURLToPath(import.meta.url));

async function isAlive() {
  try {
    const res = await fetch(BASE_URL);
    return res.ok;
  } catch {
    return false;
  }
}

/** Start vite if it isn't already running. Returns the process (or null). */
async function ensureVite() {
  if (await isAlive()) {
    if (process.env.E2E_REQUIRE_FRESH_SERVER === "1") {
      throw new Error(
        `a server is already running at ${BASE_URL}; stop it before this isolated E2E run`,
      );
    }
    console.log(`[e2e] using existing server at ${BASE_URL}`);
    return null;
  }
  console.log("[e2e] starting vite (pnpm dev)…");
  const vite = spawn("pnpm", ["dev"], {
    stdio: "ignore",
    // pnpm spawns Vite as a child. A detached process group lets teardown
    // remove both processes, preventing a later E2E run from reusing a Vite
    // server started with the wrong VITE_* environment.
    detached: process.platform !== "win32",
  });
  for (let i = 0; i < 60; i++) {
    if (await isAlive()) return vite;
    await sleep(500);
  }
  stopVite(vite);
  throw new Error(`vite did not start on ${BASE_URL}`);
}

let chrome = null;
let vite = null;
let cleanedUp = false;

function stopVite(processHandle) {
  if (!processHandle || processHandle.killed) return;
  if (process.platform !== "win32" && processHandle.pid) {
    try {
      process.kill(-processHandle.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing the parent if the group already disappeared.
    }
  }
  processHandle.kill("SIGKILL");
}

async function teardown() {
  if (cleanedUp) return;
  cleanedUp = true;
  chrome?.stop();
  stopVite(vite);
}

// Interrupts must not orphan Chrome/vite.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    teardown().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

vite = await ensureVite();
let failed = 0;
try {
  chrome = await launchChrome({ url: BASE_URL });

  const requestedSpecs = process.env.E2E_SPECS
    ? new Set(
        process.env.E2E_SPECS.split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      )
    : null;
  const specs = readdirSync(specsDir)
    .filter((file) => file.endsWith(".spec.mjs"))
    // Full TeX Live compilation is intentionally opt-in; normal E2E remains
    // deterministic and lightweight. Select it through E2E_SPECS.
    .filter((file) => requestedSpecs
      ? requestedSpecs.has(file)
      : file !== "latex-full.spec.mjs")
    .sort();
  if (!specs.length) {
    throw new Error(
      requestedSpecs
        ? `no requested E2E specs found: ${[...requestedSpecs].join(", ")}`
        : "no *.spec.mjs files found in tests/e2e",
    );
  }

  for (const spec of specs) {
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(specsDir, spec)], {
        stdio: "inherit",
        env: { ...process.env, CDP_PORT: String(chrome.port), BASE_URL },
      });
      const timer = setTimeout(() => {
        console.error(`[e2e] ${spec} exceeded ${SPEC_TIMEOUT_MS}ms — killing`);
        child.kill("SIGKILL");
      }, SPEC_TIMEOUT_MS);
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode ?? 1);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        console.error(`[e2e] could not spawn ${spec}:`, error);
        resolve(1);
      });
    });
    if (code === 0) {
      console.log(`[e2e] passed: ${spec}`);
    } else {
      failed += 1;
      console.error(`[e2e] FAILED: ${spec} (exit ${code})`);
    }
  }
} finally {
  await teardown();
}

if (failed) {
  console.error(`[e2e] ${failed} spec(s) failed`);
  process.exit(1);
}
console.log("[e2e] all specs passed");
