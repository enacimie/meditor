/**
 * E2E spec — the diagrams follow the interface theme on screen, and nowhere else.
 *
 * Mermaid decides a diagram's colours when it builds it and bakes them into a
 * stylesheet on the SVG. None of that is visible to a unit test: jsdom cannot
 * render a diagram at all, so the choice only becomes real once a browser has
 * drawn one. This reads the palette out of the stylesheet the app actually
 * produced, under each theme in turn.
 *
 * It also pins the part that is easy to get wrong in the other direction: the
 * Document view draws A4 sheets and the PDF is printed from them, so its
 * diagrams stay light whatever the app is wearing. A dark diagram there is a
 * black rectangle in the middle of a white page.
 *
 * The spec brings its own document rather than using the sample. Specs share
 * one browser and one session, and the spec that runs before this one leaves a
 * Marp deck behind — no diagrams in it, so relying on what happened to be there
 * made this fail in the suite while passing on its own. It puts back whatever
 * it found before closing, so the chain after it is unchanged.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const SESSION_KEY = "meditor.web.session.v3";
const PREFERENCES_KEY = "meditor.preferences.v1";

/** Mermaid's dark theme paints node fills #1f2020 and label text #ccc. */
const DARK_PALETTE = "/#1f2020|#ccc/i";
/** Its light theme paints them #ECECFF and #333. */
const LIGHT_PALETTE = "/#ECECFF|#333/i";

/** Two diagrams, so a theme that only reaches the first one is visible. */
const DOCUMENT = [
  "# Diagrams",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[Finish]",
  "```",
  "",
  "```mermaid",
  "graph LR",
  "  C[Left] --> D[Right]",
  "```",
  "",
].join("\n");

const page = await connect(CDP_PORT);

/**
 * Put `text` in the editor, replacing whatever is there.
 *
 * Through the editor rather than through storage, which was the first thing
 * tried and does not work: the app flushes its session as the page unloads,
 * so a document written straight into localStorage is overwritten by whatever
 * the editor still holds, moments before the reload reads it back.
 */
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

/** Store the theme, and whether the preview is paginated. */
const setPreferences = (theme, docView) =>
  page.evaluate(
    `(() => {
      const raw = localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)});
      const prefs = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        ${JSON.stringify(PREFERENCES_KEY)},
        JSON.stringify({
          ...prefs,
          theme: ${JSON.stringify(theme)},
          docView: ${docView ? "true" : "false"},
          wrap: true,
        }),
      );
      return true;
    })()`,
  );

/** The palette every rendered diagram was drawn with, and its surface. */
const diagrams = () =>
  page.evaluate(`(() => {
    const hosts = [...document.querySelectorAll('.mermaid')];
    return {
      root: document.documentElement.dataset.theme,
      drawn: hosts.map((host) => {
        const svg = host.querySelector('svg');
        const style = svg ? [...svg.querySelectorAll('style')].map((s) => s.textContent).join('') : '';
        return {
          surface: getComputedStyle(host).backgroundColor,
          styled: style.length > 0,
          dark: ${DARK_PALETTE}.test(style),
          light: ${LIGHT_PALETTE}.test(style),
        };
      }),
    };
  })()`);

/** Reload under the given theme and wait for both diagrams to be drawn. */
async function render(theme, docView) {
  await setPreferences(theme, docView);
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor("document.querySelectorAll('.mermaid svg').length >= 2", {
    timeout: 40000,
    message: `both diagrams should render under ${theme}`,
  });
  await page.waitFor(
    `[...document.querySelectorAll('.mermaid')].every((h) => h.querySelector('svg style'))`,
    { timeout: 20000, message: `a diagram under ${theme} never got its stylesheet` },
  );
  return diagrams();
}

let inheritedDocument = null;
let inheritedTheme = "system";
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor(`!!localStorage.getItem(${JSON.stringify(SESSION_KEY)})`, {
    timeout: 20000,
    message: "the app should have written a session before this replaces it",
  });
  inheritedDocument = await page.evaluate(
    `JSON.parse(localStorage.getItem(${JSON.stringify(SESSION_KEY)})).docs[0].content`,
  );
  inheritedTheme = await page.evaluate(
    `(() => {
      const raw = localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)});
      return (raw && JSON.parse(raw).theme) || "system";
    })()`,
  );

  // The document this spec measures, typed once. Every reload below carries
  // it over: the session the app flushes on unload is the one it reads back.
  await setDocument(DOCUMENT);
  await page.waitFor("document.querySelectorAll('.mermaid svg').length >= 2", {
    timeout: 40000,
    message: "the diagrams this spec types should render at all",
  });

  // ── On screen, the diagrams follow the interface ─────────────────────
  const light = await render("light", false);
  assert(light.root === "light", `expected the light theme, got ${light.root}`);
  assert(light.drawn.length >= 2, `expected two diagrams, got ${light.drawn.length}`);
  for (const [i, d] of light.drawn.entries()) {
    assert(d.styled, `diagram ${i + 1} lost its stylesheet under the light theme`);
    assert(d.light && !d.dark, `diagram ${i + 1} should be drawn light, got dark=${d.dark}`);
  }

  const dark = await render("dark", false);
  assert(dark.root === "dark", `expected the dark theme, got ${dark.root}`);
  for (const [i, d] of dark.drawn.entries()) {
    assert(d.styled, `diagram ${i + 1} lost its stylesheet under the dark theme`);
    assert(
      d.dark && !d.light,
      `diagram ${i + 1} should be drawn in Mermaid's dark palette, got dark=${d.dark} light=${d.light}`,
    );
    // Drawn for a dark page, so it must not sit on a white card any more.
    assert(
      d.surface === "rgba(0, 0, 0, 0)",
      `a dark diagram needs the page behind it, got surface ${d.surface}`,
    );
  }

  // ── High contrast keeps the pairing that was measured ────────────────
  // A light diagram on a white card is WCAG AA; Mermaid's dark palette has
  // not been measured against that bar.
  const contrast = await render("contrast", false);
  assert(contrast.root === "contrast", `expected the contrast theme, got ${contrast.root}`);
  for (const [i, d] of contrast.drawn.entries()) {
    assert(
      d.light && !d.dark,
      `diagram ${i + 1} should stay light under high contrast, got dark=${d.dark}`,
    );
    assert(
      d.surface === "rgb(255, 255, 255)",
      `a light diagram under high contrast needs its white card, got ${d.surface}`,
    );
  }

  // ── Paper is paper, whatever the app is wearing ──────────────────────
  const paged = await render("dark", true);
  assert(paged.root === "dark", `expected the dark theme, got ${paged.root}`);
  for (const [i, d] of paged.drawn.entries()) {
    assert(
      d.light && !d.dark,
      `diagram ${i + 1} is on an A4 sheet and must stay light, got dark=${d.dark}`,
    );
  }

  assert(
    page.consoleErrors.length === 0,
    `console errors while theming diagrams: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    `PASS: mermaid-theme.spec — ${light.drawn.length} diagrams light on the light theme, ` +
      `dark on the dark one, light again under high contrast and on an A4 page`,
  );
} finally {
  // Leave the session as it was found: the document this replaced, and the
  // theme. Without the theme, every spec after it inherits a dark interface.
  try {
    if (inheritedDocument !== null) await setDocument(inheritedDocument);
    await setPreferences(inheritedTheme, true);
    await page.reload();
    await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  } catch {
    /* the page may already be gone; the next spec opens its own */
  }
  await page.close();
}
