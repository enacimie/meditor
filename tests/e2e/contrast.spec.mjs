/**
 * E2E spec — high-contrast (colorblind-friendly) theme.
 *
 * Verifies, in a real headless Chrome:
 *   1. The `contrast` theme applies `data-theme="contrast"` with pure-black
 *      background and pure-white foreground.
 *   2. The primary/foreground/backdrop pairs meet WCAG AA contrast (≥ 4.5:1).
 *   3. The confirm dialog in contrast mode uses `--accent-fg` (black text on
 *      the yellow accent), so its primary button stays readable.
 *   4. No console errors along the way.
 *
 * Run via `pnpm test:e2e` (the runner sets CDP_PORT and BASE_URL).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "artifacts");
mkdirSync(artifactsDir, { recursive: true });

/** Parse a CSS color into [r, g, b, a] with a in 0..1 (alpha 1 by default). */
function parseColor(color) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    return [...[0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)), 1];
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(color);
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  }
  throw new Error(`invalid CSS color: ${color}`);
}

/** Composite `fg` (with alpha) over an opaque `bg`, returning a new color. */
function composite(fg, bg) {
  const [fr, fg_, fb, fa] = parseColor(fg);
  const [br, bg_, bb] = parseColor(bg);
  const a = fa;
  return [
    Math.round(fr * a + br * (1 - a)),
    Math.round(fg_ * a + bg_ * (1 - a)),
    Math.round(fb * a + bb * (1 - a)),
  ];
}

/** WCAG relative luminance for an sRGB color (hex, rgb() or rgba()). */
function luminance(color) {
  const [r, g, b] = color.length === 3 ? color : parseColor(color);
  const channel = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (1..21). Translucent colors are
 *  composited over opaque black before measuring. */
function contrast(fg, bg) {
  const [,,, fgAlpha] = parseColor(fg);
  const [,,, bgAlpha] = parseColor(bg);
  const opaqueFg = fgAlpha < 1 ? composite(fg, "#000000") : fg;
  const opaqueBg = bgAlpha < 1 ? composite(bg, "#000000") : bg;
  const a = luminance(opaqueFg);
  const b = luminance(opaqueBg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')");

  // ── Switch to the contrast theme via the persisted preference ──────
  // Preferences own docView/wrap/theme only; the interface language is
  // handled by I18nProvider (meditor.language.v1) on its own.
  await page.evaluate(
    `localStorage.setItem('meditor.preferences.v1', JSON.stringify({ docView: true, wrap: true, theme: 'contrast' })); true`,
  );
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')");

  const theme = await page.evaluate("document.documentElement.dataset.theme");
  assert(theme === "contrast", `expected data-theme=contrast, got ${theme}`);

  // Root colors must be the contrast palette (pure black/white).
  //
  // Wait for the palette to actually land: on a cold macOS runner the reload
  // can finish with the editor mounted but the theme's stylesheet not applied
  // yet, and the root background still reads as transparent — a fixed read
  // would fail with `rgba(0, 0, 0, 0)` for reasons that have nothing to do
  // with the colours being tested.
  await page.waitFor(
    "getComputedStyle(document.documentElement).backgroundColor !== 'rgba(0, 0, 0, 0)'",
    {
      timeout: 10000,
      message: "the contrast palette never reached :root",
    },
  );

  const rootColors = await page.evaluate(`(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.backgroundColor,
      fg: s.color,
      accent: s.getPropertyValue('--accent').trim(),
      accentFg: s.getPropertyValue('--accent-fg').trim(),
    };
  })()`);
  assert(
    rootColors.bg === "rgb(0, 0, 0)",
    `contrast bg should be black, got ${rootColors.bg}`,
  );
  assert(
    rootColors.fg === "rgb(255, 255, 255)",
    `contrast fg should be white, got ${rootColors.fg}`,
  );
  assert(
    rootColors.accent === "#ffff00",
    `contrast accent should be #ffff00, got ${rootColors.accent}`,
  );
  assert(
    rootColors.accentFg === "#000000",
    `contrast accent-fg should be #000000, got ${rootColors.accentFg}`,
  );

  // Error notices must remain visible in the explicit dark and contrast
  // themes, not only when the OS preference is dark.
  //
  // Each theme is read in its own evaluate, and the notice element is
  // re-created after switching the theme: Chrome on Windows/macOS does not
  // reliably recompute the computed style of an already-attached element when
  // `:root[data-theme]` changes, so a freshly-inserted node is used instead.
  const noticeContrast = await page.evaluate(`(() => {
    const notice = document.createElement('div');
    notice.className = 'app-notice error';
    notice.textContent = 'error';
    document.body.appendChild(notice);
    const s = getComputedStyle(notice);
    return { color: s.color, border: s.borderTopColor };
  })()`);

  await page.evaluate(`document.documentElement.dataset.theme = 'dark'; true`);

  const noticeDark = await page.evaluate(`(() => {
    document.querySelector('.app-notice.error')?.remove();
    const notice = document.createElement('div');
    notice.className = 'app-notice error';
    notice.textContent = 'error';
    document.body.appendChild(notice);
    const s = getComputedStyle(notice);
    return { color: s.color, border: s.borderTopColor };
  })()`);

  await page.evaluate(`(() => {
    document.querySelector('.app-notice.error')?.remove();
    document.documentElement.dataset.theme = 'contrast';
    return true;
  })()`);

  assert(
    noticeContrast.color === "rgb(255, 255, 255)",
    `contrast error notice text should be white, got ${noticeContrast.color}`,
  );
  assert(
    noticeDark.color === "rgb(255, 123, 114)",
    `dark error notice text should use the light error token, got ${noticeDark.color}`,
  );

  // WCAG AA: black/white is the maximum possible ratio.
  const bodyRatio = contrast(rootColors.fg, rootColors.bg);
  assert(
    bodyRatio >= 4.5,
    `body fg/bg contrast ${bodyRatio.toFixed(2)}:1 must be ≥ 4.5:1`,
  );

  // ── Confirm dialog in contrast mode ────────────────────────────────
  await page.click(".tab-add");
  await page.waitFor("document.querySelectorAll('.tab').length > 1");
  // And wait for the editor, not just the tab. CodeMirror is lazy-loaded and
  // remounts for the new document, so there is a window in which the tab is
  // on screen and `.cm-content` is not there yet. The Windows runner is slow
  // enough to land in it.
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // Dirty the active tab so closing it opens the confirm dialog.
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, 'dirty contrast');
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.tab.active .tab-dirty')");

  await page.click(".tab.active .tab-close");
  await page.waitFor("!!document.querySelector('[role=alertdialog]')");

  // The primary (destructive) button must use accent-fg (black on yellow).
  const primaryColors = await page.evaluate(`(() => {
    const el = document.querySelector('.confirm-btn--primary');
    const s = getComputedStyle(el);
    return { fg: s.color, bg: s.backgroundColor };
  })()`);
  assert(
    primaryColors.bg === "rgb(255, 255, 0)",
    `primary button bg should be yellow, got ${primaryColors.bg}`,
  );
  assert(
    primaryColors.fg === "rgb(0, 0, 0)",
    `primary button fg should be black (accent-fg), got ${primaryColors.fg}`,
  );
  const primaryRatio = contrast(primaryColors.fg, primaryColors.bg);
  assert(
    primaryRatio >= 4.5,
    `primary button contrast ${primaryRatio.toFixed(2)}:1 must be ≥ 4.5:1`,
  );

  // The secondary (cancel) button and the dialog body must also pass.
  const dialogColors = await page.evaluate(`(() => {
    const btn = document.querySelector('.confirm-btn');
    const msg = document.querySelector('.confirm-message');
    const sBtn = getComputedStyle(btn);
    const sMsg = getComputedStyle(msg);
    return {
      btnFg: sBtn.color,
      btnBg: sBtn.backgroundColor,
      msgFg: sMsg.color,
      msgBg: sMsg.backgroundColor,
      msgOpacity: sMsg.opacity,
    };
  })()`);
  assert(
    contrast(dialogColors.btnFg, dialogColors.btnBg) >= 4.5,
    "cancel button contrast must be ≥ 4.5:1",
  );
  // The message is rendered at 85% opacity, so fold that into the foreground
  // color and let contrast() composite it over the dialog background.
  const [mr, mg, mb] = parseColor(dialogColors.msgFg);
  const msgRatio = contrast(
    `rgba(${mr}, ${mg}, ${mb}, ${dialogColors.msgOpacity})`,
    dialogColors.msgBg,
  );
  assert(msgRatio >= 4.5, `dialog message contrast must be ≥ 4.5:1 (got ${msgRatio.toFixed(2)}:1)`);

  await page.screenshot(join(artifactsDir, "contrast-dialog.png"));

  // Clean up: close the dialog so the rest of the page is left untouched.
  await page.click(".confirm-btn");
  await page.waitFor("document.querySelector('[role=alertdialog]') === null");

  // ── Console health ────────────────────────────────────────────────
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );

  console.log(
    `PASS: contrast.spec — theme applied, WCAG ratios OK (body ${bodyRatio.toFixed(2)}:1, primary ${primaryRatio.toFixed(2)}:1)`,
  );
} finally {
  page.close();
}
