/**
 * E2E spec — when Chrome cannot be launched, the error says why, for every
 * binary that was tried.
 *
 * The launcher tries several binaries in turn. Its error used to carry only
 * the last one's reason, so a CI runner where Chrome hung, and four binaries
 * each timed out, reported "spawn chrome ENOENT": the fifth candidate, which
 * is not installed there. This asks for two binaries that do not exist and
 * checks both reasons come back.
 */
import { launchChrome, assert } from "./cdp.mjs";

const missing = ["meditor-no-such-chrome-one", "meditor-no-such-chrome-two"];
let message = null;
try {
  const chrome = await launchChrome({ chromeBin: missing });
  await chrome.stop();
} catch (error) {
  message = error.message;
}

assert(message !== null, "launching binaries that do not exist should fail");
for (const bin of missing) {
  assert(
    message.includes(`binary "${bin}" could not be started`),
    `the error should say why ${bin} failed, got: ${message}`,
  );
}

console.log("PASS: chrome-launch.spec — every binary tried is named in the error, with its reason");
