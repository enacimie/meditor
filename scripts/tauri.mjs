#!/usr/bin/env node
// Forwarder for the Tauri CLI that layers the optional config overlays on top
// of the base config, mirroring the frontend gates: LATEX_ENABLED for the
// LaTeX file associations (src/latexSupport.ts) and UPDATER_ENABLED for the
// in-app updater (the __UPDATER_ENABLED__ define in vite.config.ts).
//
// The release pipeline does not go through this script (tauri-apps/tauri-action
// invokes the CLI directly), so it applies the same overlays itself — keep both
// in sync. configOverlays.test.ts fails if one gains an overlay the other has
// not, which is how the updater came to be layered here late.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const building = ["build", "dev"].includes(args[0]);

const overlays = [
  ["LATEX_ENABLED", "src-tauri/conf/latex-enabled.json"],
  ["UPDATER_ENABLED", "src-tauri/conf/updater-enabled.json"],
];

const extra = building
  ? overlays.flatMap(([flag, path]) =>
      process.env[flag] === "true" ? ["--config", path] : [],
    )
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
