import { describe, expect, it } from "vitest";
import { renderMarp } from "./marpEngine";

const DECK = `---
marp: true
theme: gaia
---

# First slide

Inline math $e^{i\\pi}+1=0$.

---

## Second slide

\`\`\`js
const answer = 42;
\`\`\`
`;

describe("renderMarp", () => {
  it("renders one <section> per slide", () => {
    const { html } = renderMarp(DECK);
    const sections = html.match(/<section/g) ?? [];
    expect(sections).toHaveLength(2);
  });

  it("wraps slides in the marpit inline-SVG container", () => {
    const { html } = renderMarp(DECK);
    expect(html).toContain('class="marpit"');
    expect(html).toContain("data-marpit-svg");
  });

  it("renders math through KaTeX", () => {
    const { html } = renderMarp(DECK);
    expect(html).toContain("katex");
  });

  it("highlights code fences with highlight.js", () => {
    const { html } = renderMarp(DECK);
    expect(html).toContain("hljs-");
  });

  it("scopes the theme CSS to the marpit container", () => {
    const { css } = renderMarp(DECK);
    expect(css).toContain("section");
    expect(css).not.toMatch(/(^|\n)\s*body\s*\{/);
  });

  /*
   * A deck is ordinary Markdown, and Markdown carries raw HTML. meditor opens
   * whatever file it is pointed at, so a deck is untrusted input and none of
   * this may reach the slide.
   *
   * marp-core does neutralise it: its `html` option defaults to an allow-list
   * of tags and attributes, and meditor does not override it. That is the
   * whole of the protection, and until now nothing held it in place — a major
   * version of marp-core, or an `html: true` added one day to permit some tag,
   * would open this back up with every test still green.
   */
  const HOSTILE = `---
marp: true
---

# Slide

<script>window.pwned = 1</script>

<img src=x onerror="window.pwned = 2">

<iframe src="https://example.com/"></iframe>

<a href="javascript:alert(1)">link</a>

<div onclick="steal()">click</div>
`;

  it.each([
    ["a script tag", /<script/i],
    ["an inline error handler", /onerror\s*=/i],
    ["an embedded frame", /<iframe/i],
    ["a javascript: URL", /["']javascript:/i],
    ["an inline click handler", /onclick\s*=/i],
  ])("does not let %s through from the document", (_what, pattern) => {
    const { html } = renderMarp(HOSTILE);
    expect(html).not.toMatch(pattern);
  });

  it("keeps the harmless markup around what it strips", () => {
    // The point is a filter, not a refusal: were the slide to come back empty
    // the assertions above would pass while the feature was broken.
    const { html } = renderMarp(HOSTILE);
    expect(html).toContain("Slide");
    expect(html).toMatch(/<section/);
  });

  it("strips the plugin @font-face rules so meditor's KaTeX CSS provides fonts", () => {
    const { css } = renderMarp(DECK);
    expect(css).not.toContain("@font-face");
    expect(css).toContain(".katex");
  });
});
