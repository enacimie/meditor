export type Heading = {
  level: number;
  text: string;
  line: number; // 0-based line number
};

/**
 * Extract headings from markdown or Typst content.
 * Markdown: `# Title` through `###### Title`
 * Typst:    `= Title` through `==== Title` (at start of line)
 */
export function parseHeadings(content: string): Heading[] {
  const re = /^(#{1,6}|={1,4})\s+(.+)$/gm;
  const headings: Heading[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const line = content.slice(0, match.index).split("\n").length - 1;
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      line,
    });
  }
  return headings;
}

/** Find the active heading whose line is ≤ the cursor line. */
export function findActiveHeading(headings: Heading[], cursorLine: number): number | undefined {
  let active: number | undefined;
  for (const h of headings) {
    if (h.line <= cursorLine) active = h.line;
    else break;
  }
  return active;
}
