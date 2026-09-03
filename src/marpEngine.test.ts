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

  it("strips the plugin @font-face rules so meditor's KaTeX CSS provides fonts", () => {
    const { css } = renderMarp(DECK);
    expect(css).not.toContain("@font-face");
    expect(css).toContain(".katex");
  });
});
