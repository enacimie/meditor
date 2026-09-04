/**
 * E2E spec — presenting a deck with "reduce motion" turned on.
 *
 * It already works, and nothing held it in place. The protection is real but
 * entirely implicit, and spread across two files that never mention each
 * other:
 *
 *   - The overlay's own animations are neutralised by the universal rule in
 *     App.css, which sets `animation-duration: 0.01ms !important` on `*`.
 *     PresentOverlay.css has no reduced-motion block of its own, and does not
 *     need one — but scoping that universal rule some day, for perfectly good
 *     reasons, would silently bring the animations back.
 *   - The slide transitions never start at all: PresentOverlay.tsx checks
 *     `prefersReducedMotion()` before it arms them. Delete that check and
 *     every deck with a `transition:` directive animates again.
 *
 * Neither could be caught anywhere but in a real browser: the cascade, the
 * media query and the View Transitions API are all things jsdom does not have.
 *
 * The spec runs the same deck twice, with the setting on and off. The second
 * half is the one that makes the first half mean anything — "no animation" is
 * also what a presentation that never started looks like.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

// `transition: slide` opts into a View Transition; the `*` list gives the
// first slide two fragments, whose reveal is a CSS transition.
const DECK = [
  "---",
  "marp: true",
  "transition: slide",
  "---",
  "",
  "# Slide one",
  "",
  "* Alpha item",
  "* Beta item",
  "",
  "---",
  "",
  "# Slide two",
].join("\n");

const seconds = (value) => parseFloat(String(value)) || 0;

const page = await connect(CDP_PORT);

/** Put `text` in the editor, replacing whatever is there. */
const setDocument = (text) =>
  page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    return true;
  })()`);

/** Open the deck in presentation mode, advance one slide, and measure. */
async function present() {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(DECK)});
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.marpit')", {
    timeout: 20000,
    message: "the deck should reach the preview",
  });

  await page.click(".menu-toggle");
  await page.waitFor("!!document.querySelector('.menu-panel')");
  const opened = await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.menu-panel [role=menuitem]')]
      .find((b) => /present/i.test(b.textContent));
    if (!item) return false;
    item.click();
    return true;
  })()`);
  assert(opened, "the menu should offer a Present item for a Marp deck");
  await page.waitFor("!!document.querySelector('.present-overlay')", { timeout: 15000 });
  await page.waitFor("!!document.querySelector('.present-frag')", {
    timeout: 15000,
    message: "the first slide should carry fragments",
  });

  const before = await page.evaluate(`(() => {
    const overlay = getComputedStyle(document.querySelector('.present-overlay'));
    const frag = getComputedStyle(document.querySelector('.present-frag'));
    return {
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      overlayAnimation: overlay.animationDuration,
      fragmentReveal: frag.transitionDuration,
    };
  })()`);

  // Exhaust the two fragments, then cross to the second slide: only that last
  // press arms a transition.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); true",
    );
  }
  await page.waitFor(
    `(document.querySelector('.present-counter') || {}).textContent.trim() === '2 / 2'`,
    { timeout: 15000, message: "three presses should reach the second slide" },
  );

  const armed = await page.evaluate(
    `document.documentElement.style.getPropertyValue('--present-vt-old') || ''`,
  );
  return { ...before, armed };
}

/*
 * Both halves state the value rather than one of them clearing the override.
 *
 * Clearing it hands the question back to whatever the machine happens to
 * prefer, and CI machines prefer `reduce`: the second half then measured a
 * browser still in reduced motion and failed on all three platforms, while
 * passing here. An emulated media test that depends on the host's own setting
 * is not testing what it says it is.
 *
 * `null` really does clear, and is only used on the way out.
 */
async function emulate(preference) {
  await page.send("Emulation.setEmulatedMedia", {
    features: preference ? [{ name: "prefers-reduced-motion", value: preference }] : [],
  });
}

let sampleDocument = null;

try {
  /*
   * Keep the document this session starts with, to put back at the end.
   *
   * There is no escaping a dirty editor by clearing storage: the app flushes
   * its session on unload, so the reload inside `freshPage` writes the deck
   * back after the clear and the fresh page reads it straight in again. The
   * only way to leave storage holding the sample is to leave the *editor*
   * holding it.
   */
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor("!!localStorage.getItem('meditor.web.session.v3')", {
    timeout: 20000,
    message: "the app should have written a session to restore later",
  });
  sampleDocument = await page.evaluate(
    "JSON.parse(localStorage.getItem('meditor.web.session.v3')).docs[0].content",
  );
  assert(
    typeof sampleDocument === "string" && sampleDocument.length > 0,
    "the sample document should be readable before it is replaced",
  );

  // ── With the setting on: nothing moves ────────────────────────────
  await emulate("reduce");
  const quiet = await present();

  assert(quiet.reduce, "the reduced-motion media query should report as matching");
  assert(
    seconds(quiet.overlayAnimation) < 0.01,
    `the overlay should not animate in, got ${quiet.overlayAnimation}`,
  );
  assert(
    seconds(quiet.fragmentReveal) < 0.01,
    `fragments should not fade in, got ${quiet.fragmentReveal}`,
  );
  assert(
    quiet.armed === "",
    `no slide transition should be armed, got "${quiet.armed}"`,
  );

  // ── With it off: everything moves ─────────────────────────────────
  // Without this half the assertions above would still pass if presenting had
  // stopped working altogether.
  await emulate("no-preference");
  const moving = await present();

  assert(!moving.reduce, "the media query should not match when no-preference is emulated");
  assert(
    seconds(moving.overlayAnimation) > 0.05,
    `the overlay should animate in normally, got ${moving.overlayAnimation}`,
  );
  assert(
    seconds(moving.fragmentReveal) > 0.05,
    `fragments should fade in normally, got ${moving.fragmentReveal}`,
  );
  assert(
    moving.armed.startsWith("present-vt-"),
    `the deck's slide transition should be armed, got "${moving.armed}"`,
  );

  console.log(
    `PASS: reduced-motion.spec — quiet (overlay ${quiet.overlayAnimation}, ` +
      `fragments ${quiet.fragmentReveal}, no transition armed) vs moving ` +
      `(overlay ${moving.overlayAnimation}, fragments ${moving.fragmentReveal}, ${moving.armed})`,
  );
} finally {
  // Per-target, and every spec opens its own page — reset anyway rather than
  // leave a media override behind for whatever runs next.
  await emulate(null).catch(() => {});

  /*
   * Hand the next spec the document it expects, by leaving it in the editor:
   * closing this page flushes whatever is there into storage, and a deck left
   * behind is what made shortcuts.spec search for a word that only exists in
   * the sample. Checked rather than hoped, so that a restore which fails to
   * take fails *this* spec instead of the next one.
   */
  if (sampleDocument) {
    try {
      await page.evaluate(
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true",
      );
      await page.waitFor("!document.querySelector('.present-overlay')", { timeout: 10000 });
      await setDocument(sampleDocument);
      await page.waitFor("!/^---\\s*\\nmarp:/.test(document.querySelector('.cm-content').innerText)", {
        timeout: 10000,
        message: "the sample document should be back in the editor before closing",
      });
    } catch (error) {
      console.error(`[reduced-motion] could not restore the sample document: ${error.message}`);
      throw error;
    }
  }
  page.close();
}
