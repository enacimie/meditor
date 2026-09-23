/**
 * E2E spec — a stopped Chrome leaves no profile behind.
 *
 * Every run launches headless Chrome on a fresh profile in the temp folder
 * and removes it at the end. On Windows the removal raced Chrome's own
 * shutdown and lost, silently, so every run left some 55 MB behind. This
 * launches a second, throwaway Chrome, stops it, and checks the folder went.
 */
import { existsSync } from "node:fs";
import { launchChrome, assert } from "./cdp.mjs";

const chrome = await launchChrome({ url: "about:blank" });
const { profileDir } = chrome;
assert(existsSync(profileDir), `the profile should exist while Chrome runs: ${profileDir}`);
await chrome.stop();
assert(!existsSync(profileDir), `stopping Chrome left its profile behind: ${profileDir}`);

console.log("PASS: chrome-profile.spec — a stopped Chrome takes its profile with it");
