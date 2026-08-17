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
  // Count newlines incrementally instead of re-splitting the document at every
  // match: the naive form is quadratic and this runs on every keystroke.
  let line = 0;
  let scanned = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    for (let i = content.indexOf("\n", scanned); i !== -1 && i < match.index; i = content.indexOf("\n", i + 1)) {
      line += 1;
    }
    scanned = match.index;
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
