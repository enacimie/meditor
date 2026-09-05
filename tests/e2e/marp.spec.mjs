/**
 * E2E spec — a Marp deck renders as live slides.
 *
 * Runs in a real browser because the preview needs the marp-core browser helper
 * and inline-SVG layout, neither of which jsdom reproduces.
 *
 * The deck replaces the document, and the specs share one session: the app
 * writes it out as the page unloads, so whatever is in the editor here is what
 * the next spec opens. The sample is read before it is replaced and put back
 * before this closes.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const DECK = [
  "---",
  "marp: true",
  "theme: gaia",
  "---",
  "",
  "# First slide",
  "",
  "Inline math $e^{i\\pi}+1=0$.",
  "",
  "---",
  "",
  "## Second slide",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "```mermaid",
  "graph LR",
  "  A --> B",
  "```",
  "",
  "---",
  "",
  "### Third slide",
].join("\n");

// A deck that opts into slide transitions (front-matter `transition:`) and
// carries Marpit-native fragments: the items of a `*` list reveal one step at
// a time, the same steps Marp Bespoke paces through (its `?f=` URL parameter).
const FRAG_DECK = [
  "---",
  "marp: true",
  "theme: gaia",
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
  "",
  "* Gamma item",
].join("\n");

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

let sampleDocument = null;
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // Read the sample out of the session before the deck replaces it. Restoring
  // storage is not enough — the app overwrites it from the editor on unload —
  // so what has to be put back is the editor's own content.
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

  // Replace the sample document with a Marp deck.
  await setDocument(DECK);

  // The preview should switch to the slide view and settle on three slides.
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.marp-slides svg[data-marpit-svg]').length;
      const prev = window.__marpSlides ?? -1;
      window.__marpSlides = n;
      return n === 3 && n === prev;
    })()`,
    { timeout: 30000, interval: 400, message: "three Marp slides should render" },
  );

  // Mermaid fences are diagrammed asynchronously by the shared worker pool.
  await page.waitFor(`!!document.querySelector('.marp-slides .mermaid svg')`, {
    timeout: 30000,
    interval: 400,
    message: "the mermaid fence should render inside a slide",
  });

  const result = await page.evaluate(`(() => {
    const slides = [...document.querySelectorAll('.marp-slides svg[data-marpit-svg]')];
    return {
      slidePreview: !!document.querySelector('.marp-preview'),
      count: slides.length,
      dataLines: slides.map((s) => s.getAttribute('data-line')),
      katex: slides.some((s) => s.querySelector('.katex')),
      hljs: slides.some((s) => s.querySelector('.hljs-keyword')),
      mermaid: slides.some((s) => s.querySelector('.mermaid svg')),
      docToggleHidden: !document.querySelector('.pane-view-label'),
      atPage: [...document.querySelectorAll('.marp-slides style')]
        .some((s) => /@page\\s*\\{\\s*size:\\s*1280px 720px/.test(s.textContent)),
    };
  })()`);

  assert(result.slidePreview, "the Marp slide preview should mount");
  assert(result.count === 3, `expected 3 slides, found ${result.count}`);
  assert(result.katex, "KaTeX math should render inside a slide");
  assert(result.hljs, "code fences should be highlighted inside a slide");
  assert(result.mermaid, "a mermaid fence should be diagrammed inside a slide");
  assert(result.atPage, "the preview should carry an @page rule sizing the page to the slide");
  assert(
    result.dataLines.every((l) => l !== null && l !== ""),
    `every slide should carry a source line (got ${JSON.stringify(result.dataLines)})`,
  );
  assert(result.docToggleHidden, "the Document/Web toggle should not show for a Marp deck");

  // The exported deck must be self-contained: slides + theme CSS + KaTeX fonts
  // inlined, no scripts, nothing fetched from the network.
  const exported = await page.evaluate(
    `(async () => {
      const mod = await import('/src/exportMarpHtml.ts');
      const html = await mod.exportMarpToHtml(${JSON.stringify(DECK)}, {
        fileName: 'deck', lang: 'en', rtl: false, t: (k) => k,
      });
      const count = (re) => (html.match(re) || []).length;
      return {
        bytes: html.length,
        slides: count(/<svg data-marpit-svg/g),
        katexRules: count(/\\.katex/g),
        embeddedFonts: count(/url\\(data:font/g),
        remoteUrls: count(/url\\(\\s*["']?https?:/g),
        scripts: count(/<script\\b/g),
        links: count(/<link\\b/g),
        mermaid: count(/class="mermaid"/g),
      };
    })()`,
    60000,
  );

  assert(exported.slides === 3, `export should carry 3 slides, found ${exported.slides}`);
  assert(exported.katexRules > 50, `KaTeX rules should be embedded (found ${exported.katexRules})`);
  assert(exported.embeddedFonts > 0, `KaTeX fonts should be data URIs (found ${exported.embeddedFonts})`);
  assert(exported.remoteUrls === 0, `no remote URLs allowed (found ${exported.remoteUrls})`);
  assert(exported.scripts === 0, "the export must not carry scripts");
  assert(exported.links === 0, "the export must not link external stylesheets");
  assert(exported.mermaid > 0, `the export should carry the rendered mermaid diagram (found ${exported.mermaid})`);

  // ── Presentation mode ─────────────────────────────────────────────
  await page.click(".menu-toggle");
  await page.waitFor("!!document.querySelector('.menu-panel')");
  const foundPresent = await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.menu-panel [role=menuitem]')]
      .find((b) => /present/i.test(b.textContent));
    if (!item) return false;
    item.click();
    return true;
  })()`);
  assert(foundPresent, "the menu should offer a Present item for a Marp deck");
  await page.waitFor("!!document.querySelector('.present-overlay')", { timeout: 15000 });

  const first = await page.evaluate(`(() => ({
    active: document.querySelectorAll('.present-slides svg.present-active').length,
    counter: (document.querySelector('.present-counter') || {}).textContent || '',
  }))()`);
  assert(first.active === 1, `one slide should be on screen, found ${first.active}`);
  assert(first.counter.trim() === "1 / 3", `counter should read 1 / 3, got "${first.counter}"`);

  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); true",
  );
  await page.waitFor(
    `(document.querySelector('.present-counter') || {}).textContent.trim() === '2 / 3'`,
    { timeout: 5000, message: "ArrowRight should advance to the second slide" },
  );

  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true",
  );
  await page.waitFor("!document.querySelector('.present-overlay')", {
    timeout: 5000,
    message: "Escape should leave the presentation",
  });

  // ── Print: one slide-sized page per slide ───────────────────────────
  // This exercises the @page rule the preview injects plus the print CSS that
  // puts one slide on each page. 1280x720px at 96 dpi is 960x540 pt.
  const pdfRes = await page.send("Page.printToPDF", {
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pdfText = Buffer.from(pdfRes.result.data, "base64").toString("latin1");
  const mediaBoxes = [...pdfText.matchAll(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  assert(pageCount === 3, `print should yield one page per slide (3), found ${pageCount}`);
  assert(
    mediaBoxes.length > 0 &&
      mediaBoxes.every(([w, h]) => Math.abs(w - 960) < 3 && Math.abs(h - 540) < 3),
    `pages should be slide-sized (960x540 pt), got ${JSON.stringify(mediaBoxes)}`,
  );

  // ── Presentation: fragments reveal one step at a time ────────────────
  // Reload the editor with a deck that auto-fragments and declares a slide
  // transition, then drive the presenter from the keyboard.
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(FRAG_DECK)});
    return true;
  })()`);
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.marp-slides svg[data-marpit-svg]').length;
      const prev = window.__fragSlides ?? -1;
      window.__fragSlides = n;
      return n === 2 && n === prev;
    })()`,
    { timeout: 30000, interval: 400, message: "two fragment slides should render" },
  );

  await page.click(".menu-toggle");
  await page.waitFor("!!document.querySelector('.menu-panel')");
  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.menu-panel [role=menuitem]')]
      .find((b) => /present/i.test(b.textContent));
    item.click();
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.present-overlay')", { timeout: 15000 });

  const hiddenFrags = `document.querySelectorAll('.present-slides svg.present-active .present-frag-hidden').length`;
  const counterText = `(document.querySelector('.present-counter') || {}).textContent.trim()`;

  // Slide one starts holding back its two content blocks (the title stays).
  await page.waitFor(`(${counterText}) === '1 / 2'`, { timeout: 5000 });
  const initialHidden = await page.evaluate(hiddenFrags);
  assert(initialHidden === 2, `slide one should hold 2 fragments, found ${initialHidden}`);

  // Each ArrowRight reveals one fragment while the slide counter stays put.
  const arrow = () =>
    page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); true");
  await arrow();
  await page.waitFor(`(${hiddenFrags}) === 1`, { timeout: 5000, message: "first fragment reveals" });
  assert((await page.evaluate(counterText)) === "1 / 2", "revealing a fragment must not advance the slide");
  await arrow();
  await page.waitFor(`(${hiddenFrags}) === 0`, { timeout: 5000, message: "second fragment reveals" });

  // The next ArrowRight exhausts the fragments and moves to slide two, whose
  // single block starts hidden again. A slide move also arms the transition.
  await arrow();
  await page.waitFor(`(${counterText}) === '2 / 2'`, { timeout: 5000, message: "fragments exhausted -> next slide" });
  await page.waitFor(`(${hiddenFrags}) === 1`, { timeout: 5000, message: "slide two holds its fragment" });

  const reduced = await page.evaluate(
    "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
  );
  if (!reduced) {
    const vtOld = await page.evaluate(
      "document.documentElement.style.getPropertyValue('--present-vt-old').trim()",
    );
    assert(
      vtOld === "present-vt-slide-out-left",
      `a forward 'slide' transition should arm the outgoing animation, got "${vtOld}"`,
    );
  }

  // Going back returns to slide one fully revealed (no hidden fragments).
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); true",
  );
  await page.waitFor(`(${counterText}) === '1 / 2'`, { timeout: 5000, message: "ArrowLeft returns to slide one" });
  const backHidden = await page.evaluate(hiddenFrags);
  assert(backHidden === 0, `returning to a slide should show it fully, found ${backHidden} hidden`);

  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true",
  );
  await page.waitFor("!document.querySelector('.present-overlay')", {
    timeout: 5000,
    message: "Escape should leave the fragment presentation",
  });

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `PASS: marp.spec — ${result.count} slides, data-lines [${result.dataLines.join(",")}], ` +
      `export ${(exported.bytes / 1024).toFixed(0)} KB with ${exported.embeddedFonts} fonts, ` +
      `print ${pageCount} pages @ ${mediaBoxes[0][0]}x${mediaBoxes[0][1]}pt`,
  );
} finally {
  /*
   * Put the sample back, or every spec after this one inherits a deck. The
   * one that measures diagram themes did, and failed in the suite while
   * passing on its own — a deck has no diagrams in it.
   */
  try {
    if (sampleDocument) {
      await setDocument(sampleDocument);
      await page.waitFor(
        "!document.querySelector('.marp-slides svg[data-marpit-svg]')",
        { timeout: 10000, message: "the sample should have replaced the deck" },
      );
    }
  } catch (error) {
    // Said out loud rather than swallowed: a spec that fails to clean up
    // breaks the next one, and that is a confusing way to find out.
    console.error("marp.spec could not restore the sample document:", error);
  }
  page.close();
}
