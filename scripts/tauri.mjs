#!/usr/bin/env node
// Forwarder for the Tauri CLI that layers the LaTeX file associations on
// top of the base config when LATEX_ENABLED=true, mirroring the frontend
// gate in src/latexSupport.ts. The release pipeline does not go through
// this script (tauri-apps/tauri-action invokes the CLI directly), so it
// applies the same overlay itself — keep both in sync.
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const extra =
  process.env.LATEX_ENABLED === "true" && ["build", "dev"].includes(args[0])
    ? ["--config", "src-tauri/conf/latex-enabled.json"]
    : [];

const result = spawnSync("pnpm", ["exec", "tauri", ...args, ...extra], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
