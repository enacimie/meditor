import { describe, expect, it } from "vitest";
import { scopeCss } from "./scopeCss";

const SCOPE = ".typst-svg-wrapper";

describe("a stylesheet kept inside one element", () => {
  it("puts a bare element selector under the scope", () => {
    expect(scopeCss("svg { fill: none; }", SCOPE)).toBe(".typst-svg-wrapper svg { fill: none; }");
  });

  it("puts every selector of a list under it", () => {
    expect(scopeCss(".tsel span, .tsel { left: 0; }", SCOPE)).toBe(
      ".typst-svg-wrapper .tsel span, .typst-svg-wrapper .tsel { left: 0; }",
    );
  });

  it("does not split a selector at a comma inside parentheses or a string", () => {
    expect(scopeCss(':is(.a, .b) [title="x, y"] { color: red; }', SCOPE)).toBe(
      '.typst-svg-wrapper :is(.a, .b) [title="x, y"] { color: red; }',
    );
  });

  it("leaves the declarations as they are, a brace in a string included", () => {
    expect(scopeCss('.a::after { content: "}"; } .b { color: red; }', SCOPE)).toBe(
      '.typst-svg-wrapper .a::after { content: "}"; } .typst-svg-wrapper .b { color: red; }',
    );
  });

  it("scopes the rules inside @media, and leaves the frames of @keyframes alone", () => {
    expect(
      scopeCss("@media print { svg { fill: none; } } @keyframes ripple { to { width: 10vw; } }", SCOPE),
    ).toBe("@media print { .typst-svg-wrapper svg { fill: none; } } @keyframes ripple { to { width: 10vw; } }");
  });

  it("reads a comment before a rule as a comment", () => {
    expect(scopeCss("/* a { b } */ svg { fill: none; }", SCOPE)).toBe(
      "/* a { b } */ .typst-svg-wrapper svg { fill: none; }",
    );
  });

  it("closes a block left open at the end, as the browser does", () => {
    expect(scopeCss("@media print { svg { fill: none; }", SCOPE)).toBe(
      "@media print { .typst-svg-wrapper svg { fill: none; }}",
    );
  });

  it("leaves a block with no selector alone, rather than make it a rule for the scope", () => {
    expect(scopeCss("{ color: red; }", SCOPE)).toBe("{ color: red; }");
  });
});
