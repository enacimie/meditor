// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { md, renderMarkdown } from "./markdown";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const doc = (src: string, options?: Parameters<typeof renderMarkdown>[1]) =>
  new DOMParser().parseFromString(renderMarkdown(src, options), "text/html");
/** Every reference in the document: where it points and what it says. */
const references = (page: Document) =>
  [...page.querySelectorAll("a.crossref")].map((a) => [a.getAttribute("href"), a.textContent]);

const TABLE = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");

describe("cross-references", () => {
  it("refer to a labelled figure by its number, as a link to it, even from before it", () => {
    const page = doc(`See @fig:dot.\n\n![A dot](${PNG} "The dot"){#fig:dot}\n`);
    expect(references(page)).toEqual([["#fig:dot", "fig. 1"]]);
    expect(page.querySelector("figure#fig\\:dot figcaption")?.textContent).toBe("Figure 1. The dot");
    expect(page.body.textContent).not.toContain("{#fig");
  });

  it("use the figure's own number, counted with the unlabelled figures", () => {
    const page = doc(
      [`![One](${PNG} "First")`, "", `![Two](${PNG} "Second"){#fig:second}`, "", "@fig:second"].join("\n"),
    );
    expect(references(page)).toEqual([["#fig:second", "fig. 2"]]);
  });

  it("start with a capital as @Fig, give the number alone as -@, and read [@…] as bare", () => {
    const page = doc(`@Fig:dot, -@fig:dot and [@fig:dot].\n\n![A dot](${PNG} "The dot"){#fig:dot}\n`);
    expect(references(page)).toEqual([
      ["#fig:dot", "Fig. 1"],
      ["#fig:dot", "1"],
      ["#fig:dot", "fig. 1"],
    ]);
  });

  it("make a labelled image without a title a figure, captioned by its alt text", () => {
    const page = doc(`![A dot on the page](${PNG}){#fig:dot}\n`);
    expect(page.querySelector("figure#fig\\:dot figcaption")?.textContent).toBe("Figure 1. A dot on the page");
  });

  it("take a table's label off its caption and put it on the table", () => {
    const page = doc(`Table: Times of the runs {#tbl:times}\n\n${TABLE}\n\nSee @tbl:times.\n`);
    expect(page.querySelector("table#tbl\\:times caption")?.textContent).toBe("Table 1. Times of the runs");
    expect(references(page)).toEqual([["#tbl:times", "table 1"]]);
  });

  it("number labelled equations among themselves, anchor them, and leave the label out", () => {
    const page = doc(["$$ a = b $$ {#eq:first}", "", "$$ c = d $$ {#eq:second}", "", "@eq:second"].join("\n"));
    const second = page.querySelector("section.eqno#eq\\:second");
    expect(second?.querySelector(":scope > span")?.textContent).toBe("(2)");
    expect(page.querySelector("section.eqno#eq\\:first > span")?.textContent).toBe("(1)");
    expect(references(page)).toEqual([["#eq:second", "eq. 2"]]);
    expect(page.body.textContent).not.toContain("{#eq");
  });

  it("show a reference to a label the document does not have, in bold", () => {
    const page = doc("See @fig:nowhere.\n");
    expect(page.querySelector("strong.crossref-missing")?.textContent).toBe("¿fig:nowhere?");
    expect(references(page)).toEqual([]);
  });

  it("are not made of an email address, code, a link's text or a URL", () => {
    const page = doc(
      [
        `![A dot](${PNG} "The dot"){#fig:dot}`,
        "",
        "Mail jane@fig:dot.example, run `@fig:dot`, follow [see @fig:dot](https://example.com),",
        "open https://example.com/@fig:dot and a-word@fig:dot.",
      ].join("\n"),
    );
    expect(references(page)).toEqual([]);
    expect(page.querySelector("code")?.textContent).toBe("@fig:dot");
  });

  it("leave [@fig:x](url) a link, whose text is not a reference", () => {
    const page = doc(`[@fig:dot](https://example.com)\n\n![A dot](${PNG} "The dot"){#fig:dot}\n`);
    expect(references(page)).toEqual([]);
    expect(page.querySelector('a[href="https://example.com"]')?.textContent).toBe("@fig:dot");
  });

  it("keep the full stop after a reference outside it", () => {
    const page = doc(`It is @fig:dot.\n\n![A dot](${PNG} "The dot"){#fig:dot}\n`);
    expect(references(page)).toEqual([["#fig:dot", "fig. 1"]]);
    expect(page.querySelector("p")?.textContent).toBe("It is fig. 1.");
  });

  it("leave other prefixes and citation keys as they were written", () => {
    const page = doc("See @sec:intro and @smith2020.\n");
    expect(page.querySelector("p")?.textContent).toBe("See @sec:intro and @smith2020.");
  });

  it("take their words from the caller, in its language", () => {
    const words = { fig: "fig.", tbl: "tabla", eq: "ec." };
    const page = doc(`@tbl:t and @Eq:e.\n\nTable: T {#tbl:t}\n\n${TABLE}\n\n$$ x $$ {#eq:e}\n`, {
      crossRefText: (kind, n) => `${words[kind]} ${n}`,
    });
    expect(references(page)).toEqual([
      ["#tbl:t", "tabla 1"],
      ["#eq:e", "Ec. 1"],
    ]);
  });

  it("do not carry labels over from one render to the next", () => {
    const env = {};
    md.render(`![A dot](${PNG} "The dot"){#fig:dot}\n`, env);
    const html = md.render("See @fig:dot.\n", env);
    expect(html).toContain("¿fig:dot?");
  });
});
