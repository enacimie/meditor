import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";

const TABLE = "| Run | Time |\n| --- | ---- |\n| 2   | 41 s |";

/** Every caption in the output, as its text, in order. */
function captions(html: string): string[] {
  return [...html.matchAll(/<caption>([\s\S]*?)<\/caption>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, ""),
  );
}

/** How many tables there are, captioned or not. */
const tables = (html: string) => (html.match(/<table[\s>]/g) ?? []).length;

describe("table captions", () => {
  it("makes a caption after the table its numbered caption, above the rows", () => {
    const html = renderMarkdown(`${TABLE}\n\n: Results of the second run.\n`);
    expect(html).toMatch(
      /<table[^>]*>\n?<caption><span class="table-label">Table 1\.<\/span> Results of the second run\.<\/caption><thead[\s>]/,
    );
    // The paragraph it came from is gone.
    expect(html).not.toMatch(/<p[\s>]/);
  });

  it("takes one before the table too, written with Table:", () => {
    const html = renderMarkdown(`Table: Before it.\n\n${TABLE}\n`);
    expect(captions(html)).toEqual(["Table 1. Before it."]);
  });

  it("lets a caption before the table win over one after it", () => {
    const html = renderMarkdown(`Table: Before.\n\n${TABLE}\n\n: After.\n`);
    expect(captions(html)).toEqual(["Table 1. Before."]);
    expect(html).toMatch(/<p[^>]*>: After\.<\/p>/);
  });

  it("gives a caption between two tables to the first", () => {
    const html = renderMarkdown(`${TABLE}\n\n: Between.\n\n${TABLE}\n`);
    expect(tables(html)).toBe(2);
    expect(captions(html)).toEqual(["Table 1. Between."]);
    expect(html.indexOf("<caption>")).toBeLessThan(html.indexOf("<table", html.indexOf("</table>")));
  });

  it("gives it to the second when the first has one of its own before it", () => {
    const html = renderMarkdown(`Table: First.\n\n${TABLE}\n\n: Between.\n\n${TABLE}\n`);
    expect(captions(html)).toEqual(["Table 1. First.", "Table 2. Between."]);
  });

  it("numbers only the tables that have a caption, in order", () => {
    const html = renderMarkdown(`${TABLE}\n\nSome text.\n\n${TABLE}\n\n: The second one.\n`);
    expect(tables(html)).toBe(2);
    expect(captions(html)).toEqual(["Table 1. The second one."]);
  });

  it("keeps the caption's inline Markdown", () => {
    const html = renderMarkdown(`${TABLE}\n\n: The *second* run, in \`ms\`.\n`);
    expect(html).toContain("<caption><span class=\"table-label\">Table 1.</span> The <em>second</em> run, in <code>ms</code>.</caption>");
    const maths = renderMarkdown(`${TABLE}\n\n: Growth of $x^2$.\n`);
    expect(maths).toMatch(/<caption>[\s\S]*class="katex[\s\S]*<\/caption>/);
  });

  it("gives the caption no line number, and leaves the table its own", () => {
    const html = renderMarkdown(`${TABLE}\n\n: Results.\n`);
    expect(html).toMatch(/<table data-line="0">/);
    expect(html).toMatch(/<caption>/);
    expect(html).not.toMatch(/<caption[^>]*data-line/);
  });

  it("leaves alone what only looks like a caption", () => {
    // Not beside a table: after a paragraph, `:` is a definition.
    const definition = renderMarkdown(`${TABLE}\n\nText.\n\n: Not a caption.\n`);
    expect(captions(definition)).toEqual([]);
    expect(definition).toMatch(/<dd[\s>]/);
    // No space after the colon: a word, an emoji code, not a caption.
    const word = renderMarkdown(`${TABLE}\n\n:tada: done\n`);
    expect(captions(word)).toEqual([]);
  });

  it("works inside a quotation", () => {
    const html = renderMarkdown(`> ${TABLE.split("\n").join("\n> ")}\n>\n> : Quoted.\n`);
    expect(captions(html)).toEqual(["Table 1. Quoted."]);
  });

  it("uses the label it is given", () => {
    const html = renderMarkdown(`${TABLE}\n\n: Resultados.\n`, {
      tableLabel: (n) => `Tabla ${n}.`,
    });
    expect(captions(html)).toEqual(["Tabla 1. Resultados."]);
  });
});
