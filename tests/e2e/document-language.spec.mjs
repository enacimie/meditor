/**
 * E2E spec — a document says what language it is in.
 *
 * `lang:` in the front-matter, as Pandoc spells it, has to reach every place
 * the text is shown: the three preview containers (the measuring copy, the
 * Web view, and the pages, which paged.js builds outside the markup it is
 * handed) and the editor's content element. This reads those attributes, and
 * then what the text on a page actually inherits: the nearest `lang` above it
 * and its computed direction.
 *
 * The declaration is changed while the document is open, with real keys,
 * because that is how a writer changes it and it is the path on which the
 * editor is reconfigured rather than mounted. The interface stays in English
 * throughout, so a document in another language can be told apart from one
 * that merely inherits.
 */
import { connect, sleep } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
const LANGUAGE_KEY = "meditor.language.v1";
const MARK = "Un párrafo en castellano";

/** The document, declaring `lang` on its second line. */
const documentIn = (lang) =>
  [
    "---",
    `lang: ${lang}`,
    "---",
    "",
    "# Informe",
    "",
    `${MARK}, con texto suficiente para ocupar una línea de la página.`,
    "",
  ].join("\n");

const configFor = (lang) =>
  `window.__meditorShimConfig = ${JSON.stringify({ docContent: documentIn(lang) })};`;

/** Where the language stands in every place the document is shown. */
const READ = `(() => {
  const attributes = (el) => (el ? { lang: el.getAttribute('lang'), dir: el.getAttribute('dir') } : null);
  const inherited = (el) =>
    el ? { lang: el.closest('[lang]')?.getAttribute('lang') ?? null, direction: getComputedStyle(el).direction } : null;
  const paragraph = (selector) =>
    [...document.querySelectorAll(selector)].find((p) => p.textContent.includes(${JSON.stringify(MARK)})) ?? null;
  const editor = document.querySelector('.cm-content');
  return {
    interface: document.documentElement.getAttribute('lang'),
    source: attributes(document.querySelector('.preview-source')),
    web: attributes(document.querySelector('.markdown-body:not(.doc)')),
    paged: attributes(document.querySelector('.paged-view')),
    editor: editor && editor.textContent.includes('Informe') ? editor.getAttribute('lang') : 'not open',
    onPage: inherited(paragraph('.paged-view .pagedjs_page p')),
    onScreen: inherited(paragraph('.markdown-body:not(.doc) p')),
  };
})()`;

const page = await connect(CDP_PORT);

/**
 * Wait until every field reads as expected, and on timeout say which did not.
 * The page settles in its own time — React at once, paged.js 250 ms later —
 * so this polls instead of reading once.
 */
async function expectState(label, expected) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const reading = await page.evaluate(READ);
    const wrong = Object.entries(expected).filter(
      ([field, value]) => JSON.stringify(reading[field]) !== JSON.stringify(value),
    );
    if (wrong.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${label}: ` +
          wrong
            .map(([field, value]) => `${field} should be ${JSON.stringify(value)}, is ${JSON.stringify(reading[field])}`)
            .join("; "),
      );
    }
    await sleep(200);
  }
}

/** Reload with the preview in `docView` and the interface in English. */
async function reloadWith(docView) {
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ docView: ${docView}, wrap: true }));
    localStorage.setItem(${JSON.stringify(LANGUAGE_KEY)}, "en");
    return true;
  })()`);
  await page.reload();
}

// Mod is Cmd on macOS, for CodeMirror's Mod-Home as for everything else.
const mod = process.platform === "darwin" ? 4 : 2;
async function key(modifiers, name, code, keyCode, times = 1) {
  for (let i = 0; i < times; i++) {
    for (const type of ["keyDown", "keyUp"]) {
      await page.send("Input.dispatchKeyEvent", {
        type,
        modifiers,
        key: name,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }
  }
}

/** Rewrite the value on line 2, `lang: …`, the way a writer would. */
async function declare(from, to) {
  // Looked up and focused in one evaluation: the editor can be remounted
  // between a wait that saw it and the next round trip.
  const deadline = Date.now() + 20000;
  for (;;) {
    const focused = await page.evaluate(`(() => {
      const content = document.querySelector('.cm-content');
      if (!content) return false;
      content.focus();
      return document.activeElement === content;
    })()`);
    if (focused) break;
    if (Date.now() > deadline) throw new Error("the editor should take focus");
    await sleep(100);
  }
  await key(mod, "Home", "Home", 36);
  await key(0, "ArrowDown", "ArrowDown", 40);
  await key(0, "End", "End", 35);
  await key(0, "Backspace", "Backspace", 8, [...from].length);
  await page.send("Input.insertText", { text: to });
  // The whole document is on screen, so its second line is the second
  // rendered one. Anything else means the keys landed somewhere else.
  const line = await page.evaluate("document.querySelectorAll('.cm-content .cm-line')[1]?.textContent ?? null");
  if (line !== `lang: ${to}`) {
    throw new Error(`the second line should read ${JSON.stringify(`lang: ${to}`)}, got ${JSON.stringify(line)}`);
  }
}

let configId;
let shimId;
try {
  configId = await page.addInitScript(configFor("es"));
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await reloadWith(true);

  // Spanish, in an English interface.
  const spanish = { lang: "es", dir: "ltr" };
  await expectState("a document in Spanish", {
    interface: "en",
    source: spanish,
    web: spanish,
    paged: spanish,
    editor: "es",
    onPage: { lang: "es", direction: "ltr" },
  });

  // Declared Arabic while it is open: the direction comes with the language.
  await declare("es", "ar");
  const arabic = { lang: "ar", dir: "rtl" };
  await expectState("after declaring Arabic", {
    source: arabic,
    web: arabic,
    paged: arabic,
    editor: "ar",
    onPage: { lang: "ar", direction: "rtl" },
  });

  // Something that is not a language: nothing of its own, so the text
  // inherits the interface's again, English and left to right.
  await declare("ar", "inglés");
  const none = { lang: null, dir: null };
  await expectState("after declaring something that is not a language", {
    source: none,
    web: none,
    paged: none,
    editor: null,
    onPage: { lang: "en", direction: "ltr" },
  });

  // A document that opens already in Arabic, in the Web view.
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  configId = await page.addInitScript(configFor("ar"));
  shimId = await page.addInitScript(TAURI_SHIM);
  await reloadWith(false);
  await expectState("a document opened in Arabic, in the Web view", {
    interface: "en",
    web: arabic,
    editor: "ar",
    onScreen: { lang: "ar", direction: "rtl" },
  });

  console.log(
    "PASS: document-language.spec — lang: reaches the preview, the pages and the editor, with its direction, and a non-language is ignored",
  );
} finally {
  await page
    .evaluate(`(() => {
      localStorage.removeItem(${JSON.stringify(PREFERENCES_KEY)});
      localStorage.removeItem(${JSON.stringify(LANGUAGE_KEY)});
      return true;
    })()`)
    .catch(() => {});
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
