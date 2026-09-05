/**
 * E2E spec — a read survives the errors that mean "the page moved on".
 *
 * `wasm.spec` has failed on Windows CI four times with `Promise was collected
 * (-32000)`, always on a read taken right after a minute of WASM loading.
 * `cdp.mjs` already classes that error as transient and says so in as many
 * words, but only `waitFor` acted on the classification: a bare `evaluate`
 * propagated it and took the spec down.
 *
 * That flake cannot be reproduced on demand — two attempts in #58 failed to —
 * so this does not try. It drives the failure instead: the driver's own
 * `send` is wrapped to fail the first call the way Chrome does, and the two
 * paths are watched. A read retries and returns; an `evaluate` still gives up,
 * which is the half that has to stay true, because most of what specs
 * evaluate clicks something.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);

/**
 * Make the next `count` evaluations fail the way a collected promise does.
 *
 * Wrapping `send` rather than the page: the error comes from the CDP channel,
 * not from anything the page did, and that is the thing being simulated.
 */
function failNextEvaluations(session, count, message) {
  const original = session.send.bind(session);
  let remaining = count;
  session.send = async (method, params, timeoutMs) => {
    if (method === "Runtime.evaluate" && remaining > 0) {
      remaining--;
      throw new Error(message);
    }
    return original(method, params, timeoutMs);
  };
  return () => {
    session.send = original;
  };
}

try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── A read gets past a transient error ───────────────────────────────
  const before = page.transientReads;
  let restore = failNextEvaluations(page, 1, "Promise was collected (-32000)");
  let value;
  try {
    value = await page.read("1 + 1");
  } finally {
    restore();
  }
  assert(value === 2, `the read should have returned 2, got ${value}`);
  assert(
    page.transientReads === before + 1,
    `the retry should have been counted once, got ${page.transientReads - before}`,
  );

  // ── It does not paper over a real error ──────────────────────────────
  // A typo in an expression must still fail immediately; retrying it four
  // times would only make the spec slower before saying the same thing.
  let realError = null;
  try {
    await page.read("this is not valid javascript(");
  } catch (error) {
    realError = error;
  }
  assert(realError !== null, "a broken expression should still throw");
  assert(
    !/gave up after/.test(String(realError.message)),
    `a broken expression should fail at once, not after retries: ${realError.message}`,
  );

  // ── And it gives up rather than looping for ever ─────────────────────
  restore = failNextEvaluations(page, 99, "Execution context was destroyed");
  let exhausted = null;
  try {
    await page.read("1 + 1", { attempts: 2, delay: 10 });
  } catch (error) {
    exhausted = error;
  } finally {
    restore();
  }
  assert(exhausted !== null, "a read that never succeeds should throw");
  assert(
    /gave up after 2 attempts/.test(String(exhausted.message)),
    `the error should say how many attempts were made: ${exhausted.message}`,
  );

  // ── An ordinary evaluate still propagates ────────────────────────────
  // The half that must not change: most of what specs evaluate has side
  // effects, and running one of those twice is worse than the failure.
  restore = failNextEvaluations(page, 1, "Promise was collected (-32000)");
  let propagated = null;
  try {
    await page.evaluate("1 + 1");
  } catch (error) {
    propagated = error;
  } finally {
    restore();
  }
  assert(
    propagated !== null && /Promise was collected/.test(String(propagated.message)),
    `evaluate should still hand the error on, got ${propagated?.message}`,
  );

  console.log(
    "PASS: cdp-read.spec — a read retries a collected promise, refuses a real error, " +
      "gives up after its attempts, and evaluate still propagates",
  );
} finally {
  await page.close();
}
