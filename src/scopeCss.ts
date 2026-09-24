/**
 * A stylesheet, made to reach only what is inside one element.
 *
 * A `<style>` inside an SVG that sits in an HTML page is a stylesheet of the
 * page: its rules apply everywhere. Every selector here is put under `scope`,
 * so they apply inside it and nowhere else.
 *
 * The rules inside `@media`, `@supports`, `@container`, `@layer`, `@scope` and
 * `@starting-style` are scoped the same way. The blocks of other at-rules
 * (`@keyframes`, `@font-face`, `@page`…) hold no selectors and are kept as
 * they are. Comments and strings are read as such, so a brace or a comma in
 * them changes nothing.
 */

const GROUPING_AT_RULES = /^@(?:media|supports|container|layer|scope|starting-style)\b/i;

/** Where the comment or string starting at `at` ends (the index after it), or -1. */
function skipCommentOrString(css: string, at: number): number {
  if (css.startsWith("/*", at)) {
    const end = css.indexOf("*/", at + 2);
    return end === -1 ? css.length : end + 2;
  }
  const quote = css[at];
  if (quote !== '"' && quote !== "'") return -1;
  let i = at + 1;
  while (i < css.length && css[i] !== quote) i += css[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, css.length);
}

/** How much of `text` is whitespace and comments before anything else. */
function leadingTrivia(text: string): number {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (!text.startsWith("/*", i)) return i;
    i = skipCommentOrString(text, i);
  }
}

/** The first of `stops` at nesting depth zero from `at`, or the end of `css`. */
function findTopLevel(css: string, at: number, stops: string): number {
  let depth = 0;
  let i = at;
  while (i < css.length) {
    const skipped = skipCommentOrString(css, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    const c = css[i];
    if (depth === 0 && stops.includes(c)) return i;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ")" || c === "]" || c === "}") && depth > 0) depth--;
    i++;
  }
  return css.length;
}

function scopeSelectors(selectors: string, scope: string): string {
  const parts: string[] = [];
  let start = 0;
  while (start <= selectors.length) {
    const comma = findTopLevel(selectors, start, ",");
    parts.push(selectors.slice(start, comma));
    start = comma + 1;
  }
  return parts.map((part) => `${scope} ${part.trim()}`).join(", ");
}

export function scopeCss(css: string, scope: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const brace = findTopLevel(css, i, "{;");
    if (brace >= css.length) {
      out += css.slice(i);
      break;
    }
    if (css[brace] === ";") {
      // A statement at-rule (`@charset`, `@layer a, b;`…): nothing to scope.
      out += css.slice(i, brace + 1);
      i = brace + 1;
      continue;
    }
    const prelude = css.slice(i, brace);
    const lead = prelude.slice(0, leadingTrivia(prelude));
    const head = prelude.slice(lead.length).trim();
    // A block left open runs to the end of the sheet, as it does for the
    // browser, which closes it there.
    const close = findTopLevel(css, brace + 1, "}");
    const body = css.slice(brace + 1, close);
    const end = Math.min(close + 1, css.length);
    if (!head) {
      // A block with no selector is dropped by the browser; scoped, it would
      // become a rule for the scope itself.
      out += css.slice(i, end);
    } else if (!head.startsWith("@")) {
      out += `${lead}${scopeSelectors(head, scope)} {${body}}`;
    } else if (GROUPING_AT_RULES.test(head)) {
      out += `${lead}${head} {${scopeCss(body, scope)}}`;
    } else {
      out += css.slice(i, end);
    }
    i = end;
  }
  return out;
}
