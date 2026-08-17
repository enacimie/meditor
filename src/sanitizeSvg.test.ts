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
});
