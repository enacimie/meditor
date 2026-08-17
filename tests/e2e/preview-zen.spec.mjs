/**
 * E2E spec — hiding the preview while it paginates.
 *
 * paged.js measures its container through `offsetParent`, which is null while
 * the element is hidden or detached. Zen mode hides the whole preview pane
 * (`.app.zen .pane:last-child { display: none }`), so entering it mid-render
 * used to break pagination: paged.js threw
 * "Cannot read properties of null (reading 'getBoundingClientRect')", the
 * preview showed an error banner and the document came out truncated.
 *
 * This spec forces that race deterministically — zen is toggled as soon as the
 * editor is up, while the first pagination is still running — and then checks
 * the preview recovers when the pane comes back.
 */
import { connect, assert, sleep } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/** Dispatch a key on window, the way the app listens for shortcuts. */
const press = (page, key) =>
  page.evaluate(
    `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      return true;
    })()`,
  );

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", {
    timeout: 15000,
  });

  // Enter zen mode immediately: the initial pagination is still in flight.
  await press(page, "F11");
  await page.waitFor("document.querySelector('.app')?.classList.contains('zen') === true", {
    timeout: 5000,
    message: "zen mode should be active",
  });

  // Give the interrupted pagination time to fail the old way.
  await sleep(1500);

  const hiddenState = await page.evaluate(`(() => ({
    zen: document.querySelector('.app')?.classList.contains('zen') === true,
    error: document.querySelector('.preview-error')?.textContent ?? null,
  }))()`);
  assert(hiddenState.zen, "should still be in zen mode");
  assert(
    hiddenState.error === null,
    `hiding the preview must not surface an error banner, got: ${hiddenState.error}`,
  );

  // Leave zen mode: the preview must paginate again instead of staying blank.
  await press(page, "F11");
  await page.waitFor("document.querySelector('.app')?.classList.contains('zen') === false", {
    timeout: 5000,
    message: "zen mode should be off",
  });
  // paged.js appends pages one by one, so wait for the count to settle rather
  // than for the first page: this asserts the pagination finished, not that it
  // merely started.
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.paged-view .pagedjs_page').length;
      const previous = window.__zenPageCount ?? -1;
      window.__zenPageCount = n;
      return n > 0 && n === previous;
    })()`,
    {
      timeout: 20000,
      interval: 400,
      message: "preview should paginate again after leaving zen mode",
    },
  );

  const restored = await page.evaluate(`(() => ({
    pages: document.querySelectorAll('.paged-view .pagedjs_page').length,
    error: document.querySelector('.preview-error')?.textContent ?? null,
  }))()`);
  assert(restored.pages > 0, "preview should have at least one page");
  assert(
    restored.error === null,
    `preview should render without an error banner, got: ${restored.error}`,
  );
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `PASS: preview-zen.spec — pagination survives hiding the pane (${restored.pages} pages after restore)`,
  );
} finally {
  page.close();
}
