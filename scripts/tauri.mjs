#!/usr/bin/env node
// Forwarder for the Tauri CLI that layers the LaTeX file associations on
// top of the base config when LATEX_ENABLED=true, mirroring the frontend
// gate in src/latexSupport.ts. The release pipeline does not go through
// this script (tauri-apps/tauri-action invokes the CLI directly), so it
// applies the same overlay itself — keep both in sync.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const extra =
  process.env.LATEX_ENABLED === "true" && ["build", "dev"].includes(args[0])
    ? ["--config", "src-tauri/conf/latex-enabled.json"]
    : [];

// The CLI ships as a JS entry that launches a platform binary, so node runs
// it everywhere. Spawning pnpm instead would break on Windows, where pnpm is
// a .cmd shim that spawnSync refuses to execute without a shell.
const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [cli, ...args, ...extra], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
