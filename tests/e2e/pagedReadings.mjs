/**
 * Readings of the Document view that wait for paged.js to be done with it, and
 * say where it stopped when it never is.
 */
import { assert } from "./cdp.mjs";

/**
 * What the page says about itself when a reading never settles.
 *
 * paged.js lays out each page in an animation frame (its queue ticks on
 * `requestAnimationFrame`), so a page that stops getting frames stops
 * paginating where it is and still answers every evaluation: stuck, not
 * crashed. In print.spec on macOS CI the wide table once never arrived, and
 * the last reading showed a single portrait page for forty seconds. Whether
 * frames still come, whether the page count still moves a second or two
 * later, what the editor holds, and any error the preview shows, tell a stall
 * from text that never reached the document.
 */
const stalledPage = (page) =>
  page
    .evaluate(
      `(async () => {
        const pages = () => document.querySelectorAll('.pagedjs_page').length;
        const pagesBefore = pages();
        const frame = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 1000);
          requestAnimationFrame(() => {
            clearTimeout(timer);
            resolve(true);
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const view = document.querySelector('.cm-content')?.cmTile?.root?.view;
        const doc = view ? view.state.doc.toString() : null;
        return {
          animationFrameWithin1s: frame,
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          pages: pagesBefore,
          pagesLater: pages(),
          previewError: document.querySelector('.preview-error')?.textContent.trim() ?? null,
          editorLength: doc === null ? null : doc.length,
          editorEnd: doc === null ? null : doc.slice(-60),
        };
      })()`,
    )
    .then((facts) => ({ ...facts, consoleErrors: page.consoleErrors.slice(-3) }));

/**
 * A reading of the paged view, taken once it holds what `ready` asks for and
 * has stopped changing: three polls in a row that read the same.
 *
 * paged.js lays the pages out one by one in the container on screen, so a
 * page count that holds still between two polls can be a pagination halfway
 * through. On a slow runner print.spec once took that for the end and read
 * three portrait pages and no table at all, a moment after the table had been
 * on screen. The reading returned is the one the decision was made on, not a
 * later look that could land in the middle of another pass.
 *
 * `read` and `ready` are the source of two functions run in the page.
 */
export async function settledReading(page, read, ready, { key, message }) {
  const last = `${key}Last`;
  const settled = await page
    .waitFor(
      `(() => {
        const now = (${read})();
        const seen = (window[${JSON.stringify(key)}] ??= []);
        seen.push(JSON.stringify(now));
        if (seen.length > 3) seen.shift();
        window[${JSON.stringify(last)}] = now;
        return (${ready})(now) && seen.length === 3 && seen.every((s) => s === seen[0]);
      })()`,
      { timeout: 40000, interval: 500, message },
    )
    .then(
      () => true,
      () => false,
    );
  const reading = await page.evaluate(`window[${JSON.stringify(last)}] ?? null`);
  if (!settled) {
    const facts = await stalledPage(page).catch((error) => ({ unreadable: String(error) }));
    assert(false, `${message}: ${JSON.stringify(reading)}; the page then: ${JSON.stringify(facts)}`);
  }
  return reading;
}
