/**
 * E2E spec — the driver says where a page was when it stopped answering.
 *
 * A timed-out evaluation used to say only that it had timed out. Now the
 * driver pauses the page with the debugger and adds the stack to the error,
 * then ends the script so the spec's cleanup can still reach the page; that is
 * what found the footnote freeze of #165, which only CI could reproduce. Two
 * things it must not do in passing: stop at a `debugger;` a library left in,
 * and leave a pause pending on an idle page, where it would stop whatever
 * script the spec ran next.
 *
 * On about:blank, where no timer of the application's could be what a pause
 * lands in.
 */
import { connect, assert } from "./cdp.mjs";

const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);

/** The error an evaluation ends with, or null if it answered. */
async function failure(expression, timeoutMs) {
  try {
    await page.evaluate(expression, timeoutMs);
    return null;
  } catch (error) {
    return error.message;
  }
}

try {
  await page.navigate("about:blank");

  const through = await page.evaluate("(() => { debugger; return 'through'; })()", 5000);
  assert(through === "through", `a debugger statement stopped the page: ${through}`);

  const busy = await failure("(function spinsForever() { for (;;) {} })()", 2000);
  assert(
    busy?.includes("paused after the timeout, the page was at:") && busy.includes("spinsForever"),
    `the timeout did not say where the page was: ${busy}`,
  );
  const again = await page.evaluate("1 + 1", 5000);
  assert(again === 2, `the page did not answer after the loop was ended: ${again}`);

  const idle = await failure("new Promise(() => {})", 2000);
  assert(idle?.includes("no script ran"), `an idle page was not told from a busy one: ${idle}`);
  const next = await page.evaluate("(() => 40 + 2)()", 5000);
  assert(next === 42, `the script after an idle timeout did not run through: ${next}`);

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "cdp-stuck.spec ok — a timeout names the function the page was in, an idle page is told apart, " +
      "and neither a debugger statement nor a pending pause stops a script",
  );
} finally {
  page.close();
}
