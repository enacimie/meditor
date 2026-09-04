// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitizeSvg";

describe("sanitizeSvg", () => {
  it("preserves safe SVG content", () => {
    const output = sanitizeSvg('<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>');
    expect(output).toContain("<svg");
    expect(output).toContain("<path");
    expect(output).toContain('viewBox="0 0 10 10"');
  });

  it("removes executable content and external references", () => {
    const output = sanitizeSvg(
      '<svg onclick="alert(1)"><script>alert(1)</script><foreignObject>x</foreignObject><use href="javascript:alert(1)" /></svg>',
    );
    expect(output).not.toContain("script");
    expect(output).not.toContain("foreignObject");
    expect(output).not.toContain("onclick");
    expect(output).not.toContain("javascript:");
  });

  it("removes malformed executable helpers before strict XML parsing", () => {
    const output = sanitizeSvg(
      '<svg><script>const ready = left && right;</script><path d="M0 0" /></svg>',
    );
    expect(output).toContain("<path");
    expect(output).not.toContain("script");
    expect(output).not.toContain("&&");
  });

  it("allows internal SVG references and safe styles", () => {
    const output = sanitizeSvg(
      '<svg><style>.node { fill: #fff; }</style><defs><marker id="arrow" /></defs><path marker-end="url(#arrow)" style="stroke: #000" /></svg>',
    );
    expect(output).toContain("<style>");
    expect(output).toContain('marker-end="url(#arrow)"');
    expect(output).toContain('style="stroke: #000"');
  });

  it("removes unsafe CSS and SVG data URLs", () => {
    const output = sanitizeSvg(
      '<svg><style>@import url("https://evil.test/x.css");</style><path style="fill: url(https://evil.test/x)" /><image href="data:image/svg+xml;base64,abc" /></svg>',
    );
    expect(output).not.toContain("@import");
    expect(output).not.toContain("https://evil.test");
    expect(output).not.toContain("data:image/svg+xml");
  });
  /*
   * A stylesheet is what carries a diagram's colours, and it used to be
   * thrown away over two things that are ordinary CSS: the child combinator
   * and a reference to the document's own definitions. Losing it does not
   * look like an error — the shapes are still there, drawn in nothing.
   */
  describe("stylesheet CSS", () => {
    const withStyle = (css: string) =>
      sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><style>${css}</style><rect /></svg>`);

    it("keeps a child combinator", () => {
      expect(withStyle(".node > rect { fill: #ccc; }")).toContain("fill: #ccc");
    });

    it("keeps a reference to this document's own marker", () => {
      expect(withStyle(".edge { marker-end: url(#arrowhead); }")).toContain("url(#arrowhead)");
    });

    it("keeps that reference however it is quoted", () => {
      expect(withStyle(`.a { fill: url('#g'); }`)).toContain("url('#g')");
      expect(withStyle('.a { fill: url("#g"); }')).toContain("#g");
    });

    it("still refuses a stylesheet that fetches from elsewhere", () => {
      for (const css of [
        ".a { background: url(https://evil.test/x); }",
        ".a { background: url(//evil.test/x); }",
        ".a { background: url(/local/x.png); }",
        ".a { background: url(x.png); }",
        `.a { background: url("https://evil.test/x"); }`,
        ".a { background: url( data:image/svg+xml;base64,abc ); }",
        "@import url(#anything);",
      ]) {
        expect(withStyle(css), css).not.toContain("background");
      }
    });

    it("refuses a url it cannot read rather than ignoring it", () => {
      // An unbalanced quote matches nothing, and a loop over matches would
      // have found none to object to and waved the whole sheet through.
      expect(withStyle(`.a { background: url('#g); }`)).not.toContain("background");
    });

    it("still refuses a stylesheet carrying markup of its own", () => {
      /*
       * The one way CSS here becomes script. A raw `</style>` cannot get this
       * far — it ends the element while the document is being parsed, and the
       * script beside it is removed as a blocked element — but an entity and
       * a CDATA section both arrive as real `<` characters in the text, and
       * the sheet is put back into the page with `innerHTML`, where text
       * becomes markup again.
       */
      const entity = sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>.a { content: "&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;"; }</style><rect /></svg>',
      );
      expect(entity).not.toContain("alert(1)");
      expect(entity).not.toContain("<style>");

      const cdata = sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.a { content: "</style><script>alert(1)</script>"; }]]></style><rect /></svg>',
      );
      expect(cdata).not.toContain("alert(1)");
      expect(cdata).not.toContain("<style>");
    });

    it("still refuses the old suspects", () => {
      expect(withStyle("@import 'x.css';")).not.toContain("@import");
      expect(withStyle(".a { width: expression(alert(1)); }")).not.toContain("expression");
      expect(withStyle(".a { background: javascript:alert(1); }")).not.toContain("javascript");
      expect(withStyle(".a { -moz-binding: something; }")).not.toContain("moz-binding");
      expect(withStyle(".a { behavior: url(#x); }")).not.toContain("behavior");
    });
  });

  describe("style attributes", () => {
    it("still refuses any url() at all", () => {
      // A reference that belongs on one shape goes in `marker-end` and the
      // like, where isSafeReference checks it.
      const output = sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill: url(#g)" /></svg>',
      );
      expect(output).not.toContain("style=");
    });

    it("keeps an ordinary declaration", () => {
      const output = sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><path style="stroke: #000" /></svg>',
      );
      expect(output).toContain('style="stroke: #000"');
    });
  });
});
