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
      '<svg><style>@import url("https://evil.test/x.css");</style><path style="fill: url(https://evil.test/x)" /><use href="data:image/svg+xml;base64,abc" /></svg>',
    );
    expect(output).not.toContain("@import");
    expect(output).not.toContain("https://evil.test");
    expect(output).not.toContain("data:image/svg+xml");
  });

  /*
   * Typst writes a figure the document embeds as SVG as an `<image>` whose
   * source is that SVG, base64-encoded. Shown as an image it can run nothing
   * and fetch nothing; anywhere else the same URL could bring content in.
   */
  describe("an SVG as an image's source", () => {
    const SVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    const wrap = (inner: string) =>
      sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`,
      );

    it("is kept, in the shape Typst writes it and in plain href", () => {
      expect(wrap(`<image class="typst-image" width="113" height="56" xlink:href="${SVG}" />`)).toContain(
        `xlink:href="${SVG}"`,
      );
      expect(wrap(`<image width="10" height="10" href="${SVG}" />`)).toContain(`href="${SVG}"`);
    });

    it("is refused anywhere but an image's source", () => {
      expect(wrap(`<use href="${SVG}" />`)).not.toContain("data:image/svg+xml");
      expect(wrap(`<use xlink:href="${SVG}" />`)).not.toContain("data:image/svg+xml");
      expect(wrap(`<image mask="${SVG}" href="#m" />`)).not.toContain("data:image/svg+xml");
    });

    it("is refused unless it is base64, and an HTML document is refused as an image too", () => {
      expect(wrap('<image href="data:image/svg+xml,&lt;svg/&gt;" />')).not.toContain("data:image/svg+xml");
      expect(wrap('<image href="data:text/html;base64,PGgxPng8L2gxPg==" />')).not.toContain("data:text/html");
    });
  });
  /*
   * A stylesheet is what carries a diagram's colours, and it used to be
   * thrown away over two things that are ordinary CSS: the child combinator
   * and a reference to the document's own definitions. Losing it does not
   * look like an error — the shapes are still there, drawn in nothing.
   */
  describe("a stylesheet confined to one element", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>svg { fill: none; } .tsel span, .tsel { left: 0; }</style><rect /></svg>';

    it("has its selectors put under the element named", () => {
      const output = sanitizeSvg(svg, { scopeStylesTo: ".typst-svg-wrapper" });
      expect(output).toContain(".typst-svg-wrapper svg { fill: none; }");
      expect(output).toContain(".typst-svg-wrapper .tsel span, .typst-svg-wrapper .tsel { left: 0; }");
    });

    it("is left as it is when no element is named, as Mermaid's are", () => {
      expect(sanitizeSvg(svg)).toContain("<style>svg { fill: none; } .tsel span, .tsel { left: 0; }</style>");
    });

    it("is still removed when it is unsafe, rather than kept in its box", () => {
      const unsafe =
        '<svg xmlns="http://www.w3.org/2000/svg"><style>svg { background: url(https://example.com/x.png); }</style></svg>';
      expect(sanitizeSvg(unsafe, { scopeStylesTo: ".typst-svg-wrapper" })).not.toContain("<style");
    });
  });

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

  /*
   * `fill` and `stroke` take a paint server as well as a colour, and a paint
   * server can live in another document, which some engines then fetch.
   * These went through unread, although the comment above isSafeCss said
   * they were checked.
   */
  describe("fill and stroke", () => {
    const withPath = (attributes: string) =>
      sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" ${attributes} /></svg>`);

    it("keep a colour, and a paint server of this document, with or without a fallback", () => {
      for (const attributes of [
        'fill="red"',
        'fill="#1f2328"',
        'stroke="currentColor"',
        'fill="url(#gradient)"',
        'fill="url(#gradient) red"',
        `stroke="url('#pattern')"`,
      ]) {
        expect(withPath(attributes), attributes).toContain(attributes);
      }
    });

    it("lose a paint server anywhere else", () => {
      for (const attributes of [
        'fill="url(https://evil.test/x.svg#p)"',
        'stroke="url(//evil.test/y.svg#q)"',
        'fill="url(paint.svg#p)"',
        `fill="url('https://evil.test/x.svg#p') red"`,
        'stroke="url(data:image/svg+xml;base64,abc)"',
        `fill="url('#p) red"`,
      ]) {
        const output = withPath(attributes);
        expect(output, attributes).not.toContain("fill=");
        expect(output, attributes).not.toContain("stroke=");
      }
    });
  });
});
