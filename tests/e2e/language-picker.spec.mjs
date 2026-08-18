/**
 * E2E spec — the language search field.
 *
 * This needs a real browser: the bug it guards against was a width computed to
 * zero, and jsdom lays nothing out, so a unit test cannot see it. The field
 * still held the text and the filtering still worked — it was just clipped to
 * nothing, which is the kind of failure only layout can reveal.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  await page.click('button[aria-haspopup="menu"]');
  await page.waitFor("!!document.querySelector('[aria-controls=\"language-picker\"]')");
  await page.click('[aria-controls="language-picker"]');
  await page.waitFor("!!document.querySelector('.lang-search-input')", { timeout: 5000 });

  // Type through the value setter React listens to, so its state updates and
  // the clear button appears — which is what used to starve the field.
  await page.evaluate(`(() => {
    const input = document.querySelector('.lang-search-input');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'esp');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.lang-search-clear')", {
    message: "the clear button should appear once there is something to clear",
  });

  const field = await page.evaluate(`(() => {
    const input = document.querySelector('.lang-search-input');
    const clear = document.querySelector('.lang-search-clear');
    const wrapper = document.querySelector('.lang-search-wrapper');
    return {
      value: input.value,
      inputWidth: Math.round(input.getBoundingClientRect().width),
      clearWidth: Math.round(clear.getBoundingClientRect().width),
      wrapperWidth: Math.round(wrapper.getBoundingClientRect().width),
      results: document.querySelectorAll('[role="option"]').length,
    };
  })()`);

  assert(field.value === "esp", `the field should hold what was typed, got ${field.value}`);
  assert(
    field.clearWidth <= 40,
    `the clear button should stay a button, not a full-width row: ${field.clearWidth}px ` +
      `of a ${field.wrapperWidth}px field`,
  );
  assert(
    field.inputWidth > field.wrapperWidth / 2,
    `the text being typed must have room to show: input ${field.inputWidth}px ` +
      `of a ${field.wrapperWidth}px field (clear button ${field.clearWidth}px)`,
  );
  assert(field.results > 0, "typing a language name should still filter the list");

  assert(page.consoleErrors.length === 0, "console errors: " + page.consoleErrors.join(" | "));
  console.log(
    `PASS: language-picker.spec — the search field keeps its room (${field.inputWidth}px ` +
      `of ${field.wrapperWidth}px) and filters to ${field.results} result(s)`,
  );
} finally {
  page.close();
}
