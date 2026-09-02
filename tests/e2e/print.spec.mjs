/**
 * E2E spec — what reaches the printed page.
 *
 * `export_pdf` prints this very webview, so the PDF is whatever the @media
 * print stylesheet leaves visible. That makes print a real output of the app
 * and not just a stylesheet detail: a rule that hides a pane on screen and is
 * not scoped to `screen` silently empties the export.
 *
 * Chrome's media emulation is the only way to see this from a test — jsdom
 * applies no stylesheets, and nothing in the app's own DOM changes when the
 * media type does.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);

/** Computed display of the two panes, in DOM order: editor, preview. */
const panes = () =>
  page.evaluate(`(() => {
    const p = [...document.querySelectorAll('.split > .pane')];
    return {
      count: p.length,
      display: p.map((el) => getComputedStyle(el).display),
      appClass: document.querySelector('.app').className,
    };
  })()`);

/** Interface controls that must not end up inside the document. */
const CHROME = [".topbar", ".tabbar", ".pane-header", ".statusbar", ".zen-exit"];

const visibleChrome = () =>
  page.evaluate(`(() => ${JSON.stringify(CHROME)}
    .map((sel) => [sel, document.querySelector(sel)])
    .filter(([, el]) => el && getComputedStyle(el).display !== 'none')
    .map(([sel]) => sel))()`);

const setMedia = (media) => page.send("Emulation.setEmulatedMedia", { media });

try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The baseline: printing shows the preview, not the source ──────
  await setMedia("print");
  const normal = await panes();
  assert(normal.count === 2, `expected two panes, got ${normal.count}`);
  assert(normal.display[0] === "none", "the editor pane should not be printed");
  assert(
    normal.display[1] !== "none",
    `the preview pane is the document and must be printed, got display: ${normal.display[1]}`,
  );

  // The buttons and the word count are the app, not the document.
  const chromeInPrint = await visibleChrome();
  assert(
    chromeInPrint.length === 0,
    `no interface should reach the printed page, got: ${chromeInPrint.join(", ")}`,
  );

  // ── Zen must not change what comes out ───────────────────────────
  // Zen hides the preview on screen. Ctrl+E exports to PDF and works while
  // zen is on, so if that rule reached print media the export would be blank.
  await setMedia("screen");
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',bubbles:true})); true",
  );
  await page.waitFor("document.querySelector('.app').classList.contains('zen')");

  const zenOnScreen = await panes();
  assert(
    zenOnScreen.display[1] === "none",
    "zen is a writing mode: the preview must stay hidden on screen",
  );

  await setMedia("print");
  const zenInPrint = await panes();
  assert(
    zenInPrint.display[1] !== "none",
    `printing from zen must still produce the document, got display: ${zenInPrint.display[1]}`,
  );
  assert(
    zenInPrint.display[0] === "none",
    "the editor pane should not be printed from zen either",
  );
  const zenChrome = await visibleChrome();
  assert(
    zenChrome.length === 0,
    `no interface should reach the printed page from zen either, got: ${zenChrome.join(", ")}`,
  );

  await setMedia("");
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true",
  );
  await page.waitFor("!document.querySelector('.app').classList.contains('zen')");

  /*
   * A heading must not be the last thing on a page, with what it introduces
   * starting on the next one. `break-after: avoid` alone does not manage it —
   * paged.js will not chain it across a run of consecutive headings — so
   * previewRenderer groups each run with its first block into one element.
   */
  await page.waitFor("document.querySelectorAll('.pagedjs_page').length > 0", {
    timeout: 30000,
    interval: 500,
    message: "the paginated view should render",
  });
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__printPages ?? -1;
      window.__printPages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 30000, interval: 500, message: "pagination should settle" },
  );

  const layout = await page.evaluate(`(() => {
    // Mermaid renders to a div, not a figure: leaving it out of this list made
    // the heading above it look like the last thing on the page.
    const SEL = 'h1,h2,h3,h4,h5,h6,p,ul,ol,dl,table,pre,blockquote,figure,.mermaid,.mermaid-error,.katex-display';
    const stranded = [];
    for (const page of document.querySelectorAll('.pagedjs_page')) {
      const area = page.querySelector('.pagedjs_area') || page;
      const blocks = [...area.querySelectorAll(SEL)]
        .filter((el) => el.getBoundingClientRect().height > 0);
      const last = blocks[blocks.length - 1];
      if (last && /^H[1-6]$/.test(last.tagName)) {
        const group = last.closest('.keep-with-next');
        stranded.push({
          title: (last.innerText || '').replace(/\s+/g, ' ').slice(0, 30),
          // Grouped at all? And if so, did paged.js tear the group apart
          // anyway — which it does when the group holds something that
          // already carries break-inside: avoid, such as a Mermaid figure.
          grouped: !!group,
          groupSplit: !!(group && (group.hasAttribute('data-split-from') ||
            group.hasAttribute('data-split-to'))),
        });
      }
    }
    const source = document.querySelector('.preview-source');
    const firstBlock = source?.firstElementChild;
    return {
      stranded,
      wrappers: document.querySelectorAll('.keep-with-next').length,
      // If the grouping did not happen, these say why: it only runs when the
      // offscreen source container has layout to measure.
      pages: document.querySelectorAll('.pagedjs_page').length,
      sourceBlocks: source ? source.children.length : -1,
      sourceHeight: source ? source.offsetHeight : -1,
      firstBlockHeight: firstBlock ? firstBlock.offsetHeight : -1,
      docView: !!document.querySelector('.paged-view'),
    };
  })()`);

  assert(
    layout.wrappers > 0,
    "headings should have been grouped with their content: " + JSON.stringify(layout),
  );
  /*
   * Assert the contract, not a count: how many headings end up stranded on this
   * sample depends on font metrics, and those differ per platform. What must
   * hold everywhere is that a heading is only ever left alone for a reason we
   * know about — either the height guard declined to group it, or paged.js tore
   * the group apart despite `break-inside: avoid`, which it does when the group
   * holds something that already carries that rule, such as a Mermaid figure.
   *
   * A heading stranded inside an intact group means the mechanism has quietly
   * stopped working.
   */
  const unexplained = layout.stranded.filter((h) => h.grouped && !h.groupSplit);
  assert(
    unexplained.length === 0,
    `headings left alone at the foot of a page while their group was intact: ` +
      JSON.stringify(unexplained),
  );

  /*
   * A table wider than the page runs off the sheet, and paged.js clips there
   * (`.pagedjs_sheet { overflow: hidden }`) in print as much as on screen — so
   * the columns past the edge are simply absent from the exported PDF, with
   * nothing to say so. Wrapping the text is not enough on its own: a table
   * cannot be laid out below its intrinsic minimum, and past about fourteen
   * columns the cell padding alone outgrows the page. previewRenderer measures
   * each table and steps the type and padding down until it fits.
   *
   * The sample document's only table has three columns, so the wide case has
   * to be typed in.
   */
  const COLUMNS = 17;
  const head = Array.from({ length: COLUMNS }, (_, i) => `C${i + 1}`).join(" | ");
  const rule = Array.from({ length: COLUMNS }, () => "---").join(" | ");
  const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(8);
  const body = Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: COLUMNS }, (_, c) =>
      c === COLUMNS - 1 ? filler.slice(0, 900) : `v${r}.${c}`,
    ).join(" | "),
  );
  const doc = [
    "",
    "## Tables",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    `| ${head} |`,
    `| ${rule} |`,
    ...body.map((r) => `| ${r} |`),
    "",
  ].join("\n");

  /*
   * Appended, not typed over the top: the app flushes the session as the page
   * unloads, which lands after `freshPage` has cleared storage — so a spec
   * that replaces the whole document hands it to every spec that follows, and
   * the next one searches the sample document for text that is no longer in
   * it.
   */
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(doc)});
    return true;
  })()`);

  await page.waitFor("document.querySelectorAll('.paged-view table').length > 1", {
    timeout: 40000,
    interval: 500,
    message: "the typed tables should reach the paginated view",
  });
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__tablePages ?? -1;
      window.__tablePages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 40000, interval: 600, message: "pagination should settle around the tables" },
  );

  /*
   * The offscreen container has to be styled like the paper on its own, or
   * `fitWideTables` measures one thing and the page lays out another.
   *
   * `tableFitMetrics.test.ts` compares the two stylesheets' declarations,
   * which says they agree but not that either one still matches an element:
   * rename the selector on both sides and it stays green while the rules hit
   * nothing. That is not hypothetical — it is how the fixture came to be
   * switched off while every unit test passed.
   *
   * Reading it needs one precaution. paged.js injects its own copy of
   * paged.css into the document, and that copy reaches this container too
   * because it carries `markdown-body doc` — so once a page has been laid out
   * a dead fixture still measures correctly. It is switched off for the
   * reading, which is the state the measuring pass actually runs in.
   */
  const fixture = await page.evaluate(`(() => {
    const source = document.querySelector('.preview-source');
    const cell = source && source.querySelector('td');
    if (!cell) return { error: 'no cell in the measuring container' };

    const injected = [...document.styleSheets].filter((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) =>
          (rule.cssText || '').includes('markdown-body.doc'));
      } catch {
        return false;
      }
    });

    const onPage = document.querySelector('.pagedjs_page td');
    const page = onPage
      ? { padding: getComputedStyle(onPage).padding, fontSize: getComputedStyle(onPage).fontSize }
      : null;

    injected.forEach((sheet) => { sheet.disabled = true; });
    const alone = {
      padding: getComputedStyle(cell).padding,
      fontSize: getComputedStyle(cell).fontSize,
      display: getComputedStyle(cell.closest('table')).display,
    };
    injected.forEach((sheet) => { sheet.disabled = false; });

    return { injectedSheets: injected.length, page, alone };
  })()`);

  assert(!fixture.error, "the measuring container should hold a table: " + fixture.error);
  assert(
    fixture.injectedSheets > 0,
    "expected paged.js to have injected its stylesheet; the reading below means nothing without it",
  );
  assert(
    fixture.alone.display === "table",
    `the measuring container lays its tables out as ${fixture.alone.display}, not a table — it would measure a scroll box`,
  );
  assert(
    fixture.alone.padding === fixture.page.padding &&
      fixture.alone.fontSize === fixture.page.fontSize,
    "the measuring container is not styled like the page on its own — its rules have stopped matching. " +
      `container ${fixture.alone.fontSize}/${fixture.alone.padding}, page ${fixture.page.fontSize}/${fixture.page.padding}`,
  );

  const tables = await page.evaluate(`(() => {
    const out = [];
    for (const table of document.querySelectorAll('.paged-view table')) {
      // Measure against the page this fragment is actually on: paged.js places
      // the pages with transforms, so comparing rectangles across pages means
      // nothing.
      const area = table.closest('.pagedjs_page_content');
      if (!area) continue;
      const style = getComputedStyle(table);
      out.push({
        columns: table.querySelectorAll('th').length ||
          table.querySelectorAll('tr:first-child td').length,
        printable: area.clientWidth,
        width: table.offsetWidth,
        overflow: table.offsetWidth - area.clientWidth,
        step: [...table.classList].filter((c) => c.startsWith('table-fit')).join(',') || null,
        marginLeft: style.marginLeft,
      });
    }
    return out;
  })()`);

  assert(tables.length > 0, "the paginated view should hold tables to measure");

  const overflowing = tables.filter((t) => t.overflow > 1);
  assert(
    overflowing.length === 0,
    "tables running off the sheet lose their last columns from the PDF: " +
      JSON.stringify(overflowing),
  );

  const wide = tables.filter((t) => t.columns === COLUMNS);
  assert(wide.length > 0, `no ${COLUMNS}-column table reached the page: ` + JSON.stringify(tables));
  assert(
    wide.every((t) => t.step),
    "a table this wide cannot fit on its own and should have been stepped down: " +
      JSON.stringify(wide),
  );

  /*
   * The other half of the contract, and the easier one to break: `max-width`
   * rather than `width: 100%`, so a small table keeps its natural width and
   * stays centred — which is most tables.
   */
  const narrow = tables.filter((t) => t.columns === 2);
  assert(narrow.length > 0, "the two-column table should have reached the page");
  assert(
    narrow.every((t) => t.width < t.printable / 2 && !t.step),
    "a narrow table should keep its natural width and be left alone: " + JSON.stringify(narrow),
  );
  assert(
    narrow.every((t) => parseFloat(t.marginLeft) > 1),
    "a narrow table should stay centred on the page: " + JSON.stringify(narrow),
  );


  /*
   * A table past every portrait step can still fit a sheet turned sideways —
   * 933 px of content instead of 605. That rotation is the reader's cost, so
   * it only happens when the user asked for it in Preferences.
   *
   * Two contracts, one flag:
   *   1. With the flag off, no table ever claims a landscape page.
   *   2. With it on, a table too wide for every portrait step is marked
   *      before paged.js sees it, its pages come out landscape while the rest
   *      of the document stays portrait, and it carries a note so the reader
   *      sees the turn coming.
   *
   * Whether a given table lands in that band depends on the platform's fonts,
   * and headless runners measure a table differently while it is being laid
   * out than they render it once paginated. So instead of predicting a column
   * count that lands in the band and hard-asserting it, the spec types a wide
   * table, reads the decision the pass actually made, and holds the pass to
   * that decision: a table it marked must come out landscape, fitted and
   * announced; whatever it marked must carry the note; and the rest of the
   * document must stay portrait. The flag-off contract above is the hard one.
   */
  // Contract 1: what is already on screen has never claimed a landscape page.
  const beforeOptIn = await page.evaluate(
    `(() => ({
      marked: document.querySelectorAll('.paged-view table.needs-landscape').length,
      landscapePages: document.querySelectorAll('.pagedjs_page.pagedjs_landscape-table_page').length,
    }))()`,
  );
  assert(
    beforeOptIn.marked === 0 && beforeOptIn.landscapePages === 0,
    "landscape must stay off until the user asks: " + JSON.stringify(beforeOptIn),
  );

  // Turn the preference on the way the dialog does, reload so it applies, then
  // type the wide table — its first pagination already runs with the flag.
  await page.evaluate(`(() => {
    const key = 'meditor.preferences.v1';
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    stored.landscapeTables = true;
    localStorage.setItem(key, JSON.stringify(stored));
    return true;
  })()`);
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor("document.querySelectorAll('.pagedjs_page').length > 0", {
    timeout: 40000,
    interval: 500,
    message: "the session should repaginate after the reload",
  });

  // A wide table aimed at the landscape band: a probe column, measured once
  // the real fonts are in, sizes the column count. On runners where the fonts
  // land it in the band the pass marks it; where they do not, the assertions
  // below still hold the pass to whatever it decided.
  const COLS = "(t.querySelectorAll('th').length || t.querySelectorAll('tr:first-child td').length)";
  const probe = await page.evaluate(`(async () => {
    await document.fonts.ready;
    const probe = document.createElement('table');
    probe.className = 'table-fit-3';
    probe.style.cssText = 'position:absolute;visibility:hidden;width:auto';
    probe.innerHTML =
      '<thead><tr>${"<th>x</th>".repeat(10)}</tr></thead>' +
      '<tbody><tr>${"<td>8</td>".repeat(10)}</tr></tbody>';
    document.querySelector('.preview-source').append(probe);
    probe.style.width = 'min-content';
    probe.style.maxWidth = 'none';
    const width = probe.offsetWidth;
    probe.remove();
    return width / 10;
  })()`);
  const LAND_COLUMNS = Math.min(200, Math.max(2, Math.round(770 / probe)));
  const landHead = Array.from({ length: LAND_COLUMNS }, () => "x").join(" | ");
  const landRule = Array.from({ length: LAND_COLUMNS }, () => "---").join(" | ");
  const landRow = Array.from({ length: LAND_COLUMNS }, () => "8").join(" | ");
  const landDoc = ["", `| ${landHead} |`, `| ${landRule} |`, `| ${landRow} |`, ""].join("\n");

  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(landDoc)});
    return true;
  })()`);

  await page.waitFor(
    `(() => [...document.querySelectorAll('.paged-view table')].some((t) =>
      (${COLS}) === ${LAND_COLUMNS})())`,
    { timeout: 40000, interval: 500, message: "the wide table should reach the paginated view" },
  );
  await page.waitFor(
    `(() => {
      const count = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__landPages ?? -1;
      window.__landPages = count;
      return count > 0 && count === previous;
    })()`,
    { timeout: 40000, interval: 600, message: "pagination should settle with landscape on" },
  );

  const afterOptIn = await page.evaluate(`(() => {
    const cols = (t) =>
      t.querySelectorAll('th').length || t.querySelectorAll('tr:first-child td').length;
    const onLandscape = (t) =>
      !!t.closest('.pagedjs_page')?.classList.contains('pagedjs_landscape-table_page');
    const wide = [...document.querySelectorAll('.paged-view table')].filter((t) =>
      cols(t) === ${LAND_COLUMNS});
    const allMarked = [...document.querySelectorAll('.paged-view table.needs-landscape')];
    return {
      wideCount: wide.length,
      wideMarked: wide.some((t) => t.classList.contains('needs-landscape')),
      wideOnLandscape: wide.length > 0 && wide.every(onLandscape),
      wideNote: wide[0]?.getAttribute('data-landscape-note') ?? null,
      wideFits: wide.every((t) => {
        const area = t.closest('.pagedjs_page_content');
        return area && t.offsetWidth <= area.clientWidth + 1;
      }),
      allMarkedCount: allMarked.length,
      markedWithNote: allMarked.filter((t) => t.getAttribute('data-landscape-note')).length,
      markedOnLandscape: allMarked.every(onLandscape),
      landscapePages: document.querySelectorAll('.pagedjs_page.pagedjs_landscape-table_page').length,
      portraitPages: document.querySelectorAll('.pagedjs_page:not(.pagedjs_landscape-table_page)').length,
    };
  })()`);

  assert(afterOptIn.wideCount > 0, "the wide table should reach the paginated view: " + JSON.stringify(afterOptIn));
  // The opt-in must actually take: with a table wider than any portrait step
  // in the document, something claims a landscape page. This is what catches
  // the feature silently deciding nothing ever needs one.
  assert(
    afterOptIn.allMarkedCount > 0 && afterOptIn.landscapePages > 0,
    "with the opt-in on, a wide document should claim at least one landscape page: " +
      JSON.stringify(afterOptIn),
  );
  // Whatever the pass marked, paged.js turned sideways and labelled — the
  // reader is never handed a sideways page without the note that says so.
  assert(
    afterOptIn.markedWithNote === afterOptIn.allMarkedCount && afterOptIn.markedOnLandscape,
    "every table marked for a landscape page must sit on one and carry the note: " +
      JSON.stringify(afterOptIn),
  );
  if (afterOptIn.wideMarked) {
    // The fixture landed in the band on this runner: it must have claimed a
    // landscape sheet, fit it, and announced the turn.
    assert(
      afterOptIn.wideOnLandscape && afterOptIn.landscapePages > 0,
      "a table marked for landscape should sit on a landscape page: " + JSON.stringify(afterOptIn),
    );
    assert(
      afterOptIn.wideFits,
      "the table must fit its landscape sheet rather than run off it: " + JSON.stringify(afterOptIn),
    );
    assert(
      typeof afterOptIn.wideNote === "string" && afterOptIn.wideNote.length > 0,
      "the reader should see the sideways page coming: " + JSON.stringify(afterOptIn),
    );
  }
  assert(
    afterOptIn.portraitPages > 0,
    "the rest of the document must stay portrait: " + JSON.stringify(afterOptIn),
  );

  // Put the preference back so the specs that follow get the stock defaults.
  await page.evaluate(`(() => {
    const key = 'meditor.preferences.v1';
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    delete stored.landscapeTables;
    localStorage.setItem(key, JSON.stringify(stored));
    return true;
  })()`);

  assert(page.consoleErrors.length === 0, "console errors: " + page.consoleErrors.join(" | "));
  console.log("PASS: print.spec — the preview reaches the printed page, from zen too");
} finally {
  // Leave the browser on screen media for the specs that follow.
  await page.send("Emulation.setEmulatedMedia", { media: "" }).catch(() => {});
  page.close();
}
