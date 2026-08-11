// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { splitLongFencedBlocks } from "./previewRenderer";

/* ---- splitLongFencedBlocks ---- */
describe("splitLongFencedBlocks", () => {
  it("returns unchanged markdown when no fenced blocks exist", () => {
    const input = "# Hello\n\nSome paragraph text.";
    expect(splitLongFencedBlocks(input)).toBe(input);
  });

  it("returns unchanged markdown for short fenced blocks", () => {
    const input = [
      "```js",
      "const x = 1;",
      "const y = 2;",
      "```",
    ].join("\n");
    expect(splitLongFencedBlocks(input)).toBe(input);
  });

  it("splits a long fenced block into multiple chunks", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`line${i}`);
    }
    const input = ["```js", ...lines, "```"].join("\n");
    const result = splitLongFencedBlocks(input, 45);

    // Should have 3 chunks: 45 + 45 + 10 lines
    const chunks = result.split("\n\n");
    expect(chunks.length).toBe(3);
    // First chunk: 45 lines of code
    expect(chunks[0]).toContain("```js");
    expect(chunks[0]).toContain("line0");
    expect(chunks[0]).toContain("line44");
    // Second chunk: next 45 lines
    expect(chunks[1]).toContain("```js");
    expect(chunks[1]).toContain("line45");
    expect(chunks[1]).toContain("line89");
    // Third chunk: remaining 10
    expect(chunks[2]).toContain("```js");
    expect(chunks[2]).toContain("line90");
    expect(chunks[2]).toContain("line99");
  });

  it("preserves the language identifier on all chunks", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push("// comment");
    const input = ["```typescript", ...lines, "```"].join("\n");
    const result = splitLongFencedBlocks(input, 45);

    const chunks = result.split("\n\n");
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("```typescript");
    expect(chunks[1]).toContain("```typescript");
  });

  it("uses custom maxLines parameter", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push("x");
    const input = ["```", ...lines, "```"].join("\n");

    // maxLines=10 → 2 chunks
    const result10 = splitLongFencedBlocks(input, 10);
    expect(result10.split("\n\n").length).toBe(2);

    // maxLines=40 → 1 chunk (unchanged)
    const result40 = splitLongFencedBlocks(input, 40);
    expect(result40).toBe(input);
  });

  it("handles multiple fenced blocks in one document", () => {
    const longLines: string[] = [];
    for (let i = 0; i < 50; i++) longLines.push(`line${i}`);

    const input = [
      "# Doc",
      "",
      "```python",
      ...longLines,
      "```",
      "",
      "Some text",
      "",
      "```bash",
      "echo short",
      "```",
    ].join("\n");

    const result = splitLongFencedBlocks(input, 30);
    // The python block should be split (50 lines → 2 chunks at 30 limit)
    // The bash block should stay intact
    const chunks = result.split("\n\n");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(result).toContain("echo short");
    expect(result).toContain("```bash");
  });

  it("handles trailing blank line inside fenced block", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push("x");

    const input = ["```", ...lines, "```"].join("\n");
    const result = splitLongFencedBlocks(input, 30);
    const chunks = result.split("\n\n");
    // 60 lines ÷ 30 = exactly 2 chunks
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("```");
    expect(chunks[1]).toContain("```");
  });

  it("handles indented fences (3+ backticks)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push("a");
    const input = ["````md", ...lines, "````"].join("\n");
    const result = splitLongFencedBlocks(input, 30);
    expect(result.split("\n\n").length).toBe(2);
  });

  it("does not split non-fenced backtick sequences", () => {
    const input = "Inline `code` with `backticks` and ```not a block";
    expect(splitLongFencedBlocks(input, 5)).toBe(input);
  });
});
