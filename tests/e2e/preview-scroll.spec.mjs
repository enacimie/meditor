/**
 * E2E spec — preview scrolling.
 *
 * Verifies the rendered Markdown preview is not clipped by the split pane and
 * that its actual scroll container can move vertically.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", {
    timeout: 15000,
  });
  await page.waitFor(
    "(() => { const el = document.querySelector('.preview-scroll'); return !!el && el.scrollHeight > el.clientHeight; })()",
    {
      timeout: 15000,
      message: "Markdown preview should have vertical overflow",
    },
  );

  const state = await page.evaluate(`(() => {
    const el = document.querySelector('.preview-scroll');
    if (!(el instanceof HTMLElement)) return null;
    const style = getComputedStyle(el);
    el.scrollTop = Math.min(160, el.scrollHeight - el.clientHeight);
    return {
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    };
  })()`);

  assert(state, "preview scroll container should exist");
  assert(
    state.overflowY === "auto" || state.overflowY === "scroll",
    `preview overflow should be scrollable, got ${state.overflowY}`,
  );
  assert(
    state.scrollHeight > state.clientHeight,
    "preview content should exceed its viewport",
  );
  assert(state.scrollTop > 0, "preview scroll position should change");
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log("PASS: preview-scroll.spec — Markdown preview scrolls vertically");
} finally {
  page.close();
}
