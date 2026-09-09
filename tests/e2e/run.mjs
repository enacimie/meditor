/**
 * E2E test runner.
 *
 * Orchestrates the whole flow so specs only care about the page:
 *   1. Starts vite if nothing is already serving the app.
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

/**
 * Run against the built application rather than the dev server.
 *
 * Everything here has always watched `vite` in development, and that hid a
 * defect for a whole release cycle: `paged.css` is imported with `?inline`,
 * which Vite serves verbatim while developing and **minifies on build**, and
 * the code that put the chosen paper into it matched on line starts. In every
 * built copy nothing matched, the Document view drew no pages at all, and
 * every spec below still passed.
 *
 * So this mode builds and serves `dist/`. It is a separate run rather than
 * the default because it costs a production build, and because a spec that
 * fails only here is telling you something quite different from one that
 * fails in development.
 */
const BUILT = process.argv.includes("--built");

/**
 * What is worth running twice.
 *
 * Those whose subject is the printed page, which is where the difference
 * between the served and the built stylesheet actually shows. `E2E_SPECS`
 * overrides this, so a suspected build-only failure anywhere can be pointed
 * at without editing the list.
 *
 * `export-html.spec.mjs` belongs here by subject — the HTML export builds its
 * page frame from the same module — and cannot be here in practice: it
 * imports `/src/exportHtml.ts` into the page, which is a path only the dev
 * server serves. Reaching the export in a built app means driving the
 * interface and catching what it writes, which is a change to that spec
 * rather than to this list. The stylesheet itself is still covered, by the
 * seven below.
 */
const BUILT_SPECS = [
  "document-page.spec.mjs",
  "front-matter.spec.mjs",
  "page-break.spec.mjs",
  "page-margin.spec.mjs",
  "page-numbers.spec.mjs",
  "print.spec.mjs",
  "toc.spec.mjs",
];

// `vite preview` has its own default port, and using it keeps a built run from
// colliding with a dev server somebody left open.
const PORT = Number(process.env.E2E_PORT ?? (BUILT ? 4173 : 1420));
const STARTUP_TIMEOUT_MS = Number(process.env.E2E_STARTUP_TIMEOUT_MS ?? 60_000);
const SPEC_TIMEOUT_MS = 180_000;
const specsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(specsDir, "..", "..");

// Vite binds to `localhost`, which resolves to ::1 on most systems, so probing
// only the IPv4 literal reports a healthy server as missing. Probe the
// equivalent spellings and keep whichever answers, so Chrome and the specs get
// a URL that actually reaches the server. An explicit BASE_URL wins untouched.
const CANDIDATE_URLS = process.env.BASE_URL
  ? [process.env.BASE_URL]
  : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`];
let BASE_URL = CANDIDATE_URLS[0];

/** First candidate URL that serves the app, or null while none does. */
async function reachableUrl() {
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return url;
    } catch {
      // Not listening (yet) on this spelling.
    }
  }
  return null;
}

/**
 * Build, and refuse to carry on if the build fails.
 *
 * Always built, never reused: a `dist/` left over from an earlier run would
 * make this whole mode a decoration, which is the failure it exists to
 * prevent.
 */
async function buildForPreview() {
  console.log("[e2e] building for the preview run…");
  const code = await new Promise((resolve) => {
    const build = spawn(
      process.execPath,
      [join(projectRoot, "node_modules", "vite", "bin", "vite.js"), "build"],
      { cwd: projectRoot, stdio: "inherit" },
    );
    build.on("exit", (exitCode) => resolve(exitCode ?? 1));
    build.on("error", () => resolve(1));
  });
  if (code !== 0) throw new Error(`vite build failed with exit code ${code}`);
}

/** Start vite if it isn't already running. Returns the process (or null). */
async function ensureVite() {
  const running = await reachableUrl();
  if (running) {
    if (process.env.E2E_REQUIRE_FRESH_SERVER === "1") {
      throw new Error(
        `a server is already running at ${running}; stop it before this isolated E2E run`,
      );
    }
    BASE_URL = running;
    console.log(`[e2e] using existing server at ${BASE_URL}`);
    return null;
  }
  if (BUILT) await buildForPreview();
  console.log(BUILT ? "[e2e] serving dist/…" : "[e2e] starting vite…");
  // Run Vite's own entry point instead of `pnpm dev`: the package manager is a
  // .cmd shim on Windows, which spawn() cannot execute without a shell, and it
  // would sit between us and Vite so teardown could not reliably kill the
  // server. A detached process group still lets teardown remove any children,
  // preventing a later E2E run from reusing a Vite server started with the
  // wrong VITE_* environment.
  const viteArgs = [join(projectRoot, "node_modules", "vite", "bin", "vite.js")];
  if (BUILT) {
    // `--strictPort` so a preview that cannot have the port fails loudly
    // instead of moving to another one and leaving the specs pointed at
    // whatever else was listening.
    viteArgs.push("preview", "--port", String(PORT), "--strictPort");
  }
  const vite = spawn(process.execPath, viteArgs, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  // Keep the output so a failure to start can explain itself instead of just
  // timing out silently.
  let output = "";
  const record = (chunk) => {
    output = (output + chunk).slice(-4000);
  };
  vite.stdout.on("data", record);
  vite.stderr.on("data", record);
  let spawnError = null;
  let exited = false;
  vite.on("error", (error) => {
    spawnError = error;
  });
  vite.on("exit", (code, signal) => {
    exited = true;
    record(`\n[vite exited: code=${code} signal=${signal}]`);
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && !spawnError && !exited) {
    const url = await reachableUrl();
    if (url) {
      BASE_URL = url;
      console.log(`[e2e] vite is serving ${BASE_URL}`);
      return vite;
    }
    await sleep(250);
  }
  stopVite(vite);
  const detail = [
    spawnError ? `could not spawn vite: ${spawnError.message}` : null,
    exited ? "vite exited before serving" : null,
    output.trim() ? `vite output:\n${output.trim()}` : "vite produced no output",
  ]
    .filter(Boolean)
    .join("\n");
  throw new Error(
    `vite did not serve any of ${CANDIDATE_URLS.join(", ")} within ${STARTUP_TIMEOUT_MS}ms\n${detail}`,
  );
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
    : BUILT
      ? new Set(BUILT_SPECS)
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
