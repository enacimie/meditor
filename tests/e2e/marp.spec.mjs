/**
 * E2E spec — a Marp deck renders as live slides.
 *
 * Runs in a real browser because the preview needs the marp-core browser helper
 * and inline-SVG layout, neither of which jsdom reproduces.
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

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // Replace the sample document with a Marp deck.
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
  page.close();
}
