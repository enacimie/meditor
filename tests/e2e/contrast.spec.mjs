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

  /*
   * ── Tables on paper ───────────────────────────────────────────────
   *
   * This spec already runs in the document view, which is the one place the
   * two halves of a table's colour come from different worlds: the paged
   * stylesheet forces black ink on white paper, while the zebra stripe on
   * every second row is a theme variable. Where that variable is dark — the
   * dark theme, and this one, where it is #0a0a0a — the result is black text
   * on a black band.
   *
   * Checked here rather than in a spec of its own because the setup is
   * already exactly right, and because the contrast theme is where it hurts
   * most: the readable theme is the one that ends up unreadable.
   */
  await page.waitFor("!!document.querySelector('.paged-view table tbody tr td')", {
    timeout: 25000,
    message: "the sample table should reach the paged view",
  });
  const tableCells = await page.evaluate(`(() => {
    // The stripe sits on the row and the cells are transparent, so the colour
    // that actually shows has to be looked for up the tree.
    const shown = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    return [...document.querySelectorAll('.paged-view table tbody tr')]
      .map((tr, row) => {
        const cell = tr.querySelector('td');
        return cell && { row, color: getComputedStyle(cell).color, background: shown(cell) };
      })
      .filter(Boolean);
  })()`);
  assert(tableCells.length > 0, "expected table rows in the paged view");
  const worstCell = tableCells
    .map((cell) => ({ ...cell, ratio: contrast(cell.color, cell.background) }))
    .sort((a, b) => a.ratio - b.ratio)[0];
  assert(
    worstCell.ratio >= 4.5,
    `every table row on paper must stay readable: row ${worstCell.row} is ` +
      `${worstCell.ratio.toFixed(2)}:1 (${worstCell.color} on ${worstCell.background})`,
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


  /*
   * ── The editor in the dark themes ─────────────────────────────────
   *
   * CodeMirror ships a light and a dark value for its selection, its drawn
   * caret and its panels, and picks between them by a flag the app's theme
   * never set. Every theme therefore got the light one: a near-white
   * selection behind light text (1.03:1 in dark, 1.44:1 here) and a caret
   * painted black — on this theme's pure black page, 1.00:1 exactly.
   *
   * Read from a real browser rather than from the stylesheet, because the
   * base rules are more specific than they look: `&light` compounds two
   * classes on one element, so a plainly-written override silently loses and
   * the fix would appear to be in place while changing nothing.
   */
  // Headless Chrome hands the page no real focus, so `.cm-focused` never
  // appears and the focused-selection rules — the ones that matter, since you
  // select while typing — would never be exercised.
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  for (const themeName of ["contrast", "dark"]) {
    // The web view, not the document one: on paper the diagram already sits on
    // white, so the surface below is only wrong on screen.
    await page.evaluate(
      `localStorage.setItem('meditor.preferences.v1', JSON.stringify({ docView: false, wrap: true, theme: ${JSON.stringify(themeName)} })); true`,
    );
    await page.reload();
    await page.waitFor("!!document.querySelector('.cm-content')");
    await page.waitFor(
      `document.documentElement.dataset.theme === ${JSON.stringify(themeName)}`,
      { message: `the ${themeName} theme never reached :root` },
    );

    await page.evaluate("document.querySelector('.cm-content').focus(); true");
    await page.waitFor(
      "document.querySelector('.cm-editor').classList.contains('cm-focused')",
      { message: "the editor never took focus" },
    );
    // A DOM Range does not reach CodeMirror — drawSelection keeps its own
    // selection — so this is a real select-all through its keymap.
    //
    // CodeMirror binds that to Mod-a, and Mod is Cmd on macOS and Ctrl
    // everywhere else. CDP takes a bitmask — 1 Alt, 2 Ctrl, 4 Meta, 8 Shift
    // — so sending Ctrl unconditionally selects nothing on a Mac, and the
    // check then reports that rather than passing over what it should be
    // measuring.
    const selectAllModifier = process.platform === "darwin" ? 4 : 2;
    for (const type of ["keyDown", "keyUp"]) {
      await page.send("Input.dispatchKeyEvent", {
        type,
        modifiers: selectAllModifier,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
      });
    }
    await page.waitFor("!!document.querySelector('.cm-selectionBackground')", {
      message: "Ctrl+A should have drawn a selection",
    });

    const editorColors = await page.evaluate(`(() => {
      const editor = document.querySelector('.cm-editor');
      const line = document.querySelector('.cm-line');
      const cursor = document.querySelector('.cm-cursor');
      const selection = document.querySelector('.cm-selectionBackground');
      return {
        editorBg: getComputedStyle(editor).backgroundColor,
        text: getComputedStyle(line).color,
        selectionBg: getComputedStyle(selection).backgroundColor,
        caret: cursor ? getComputedStyle(cursor).borderLeftColor : null,
      };
    })()`);

    // The selection is a layer behind the text, so what the reader sees is it
    // composited over the editor's own background.
    const selectionBg = composite(editorColors.selectionBg, editorColors.editorBg);
    const selectionRatio = contrast(editorColors.text, `rgb(${selectionBg.join(", ")})`);
    assert(
      selectionRatio >= 4.5,
      `${themeName}: selected text sits at ${selectionRatio.toFixed(2)}:1 against its highlight, must be ≥ 4.5:1`,
    );

    // A caret is a user-interface component, so 3:1 is the bar it has to clear
    // (WCAG 1.4.11), not the 4.5:1 asked of text.
    assert(editorColors.caret !== null, `${themeName}: the editor should draw a caret`);
    const caretRatio = contrast(editorColors.caret, editorColors.editorBg);
    assert(
      caretRatio >= 3,
      `${themeName}: the caret sits at ${caretRatio.toFixed(2)}:1 against the page, must be ≥ 3:1 — you cannot see where you are typing`,
    );

    // The find panel: a ratio would not catch this one, because black on
    // #f5f5f5 reads perfectly well. The defect is that it is a white window
    // inside a dark editor.
    await page.evaluate(
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); true",
    );
    await page.waitFor("!!document.querySelector('.cm-panels')", {
      message: "Ctrl+K should open the find panel",
    });
    const panel = await page.evaluate(`(() => {
      const el = document.querySelector('.cm-panels');
      const style = getComputedStyle(el);
      return { bg: style.backgroundColor, fg: style.color };
    })()`);
    assert(
      luminance(panel.bg) < luminance(editorColors.editorBg) + 0.2,
      `${themeName}: the find panel (${panel.bg}) is far lighter than the editor it lives in (${editorColors.editorBg})`,
    );
    const panelRatio = contrast(panel.fg, panel.bg);
    assert(
      panelRatio >= 4.5,
      `${themeName}: find panel text contrast ${panelRatio.toFixed(2)}:1 must be ≥ 4.5:1`,
    );

    // Mermaid draws its lines and edge labels in #333 whatever the app theme
    // is, so the surface underneath has to be one they show up on.
    // Measured on an element made for the purpose, the way the error notice
    // above is: by this point the document has been typed over and holds no
    // diagram, and rendering one would mean waiting on the Mermaid worker for
    // a value that comes from a stylesheet. #333 is Mermaid's own lineColor
    // and textColor, read from its default theme.
    const diagramBg = await page.evaluate(`(() => {
      const host = document.createElement('div');
      host.className = 'markdown-body';
      const diagram = document.createElement('div');
      diagram.className = 'mermaid';
      host.appendChild(diagram);
      document.body.appendChild(host);
      const background = getComputedStyle(diagram).backgroundColor;
      host.remove();
      return background;
    })()`);
    const diagramRatio = contrast("#333333", diagramBg);
    assert(
      diagramRatio >= 3,
      `${themeName}: Mermaid's #333 lines sit at ${diagramRatio.toFixed(2)}:1 on ${diagramBg} — the arrows are invisible`,
    );
  }

  // Leave the browser as the specs that follow expect to find it.
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: false });

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
