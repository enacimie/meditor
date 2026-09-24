import { frontMatterLines } from "../frontMatter";
import type { DocKind } from "../types";

export type Heading = {
  level: number;
  text: string;
  line: number; // 0-based line number
};

/** A heading line in each language: `#` to `######` in Markdown, `=` to `====` in Typst. */
const HEADING: Partial<Record<DocKind, RegExp>> = {
  markdown: /^(#{1,6})[ \t]+(.+)$/,
  typst: /^(={1,4})[ \t]+(.+)$/,
};

/**
 * The line that opens or closes a fenced code block. CommonMark allows three
 * spaces before it, and backticks or tildes; a Typst raw block is backticks.
 */
const FENCE: Partial<Record<DocKind, RegExp>> = {
  markdown: /^ {0,3}(`{3,}|~{3,})(.*)$/,
  typst: /^ {0,3}(`{3,})(.*)$/,
};

/** The characters either of those can start with. */
const LINE_STARTS = "#=`~ ";

/**
 * The headings of a document, for the outline.
 *
 * Only what is a heading in the document's own language: a `#` inside a
 * fenced code block is a shell or Python comment, and in the front-matter a
 * YAML one; a `= ` line in Markdown is text, and in Typst `#` starts code.
 * LaTeX's sectioning commands are not read, so a LaTeX document has none.
 *
 * Walked line by line, once: this runs on every keystroke while the outline
 * is open.
 */
export function parseHeadings(content: string, kind: DocKind): Heading[] {
  const heading = HEADING[kind];
  const fenceLine = FENCE[kind];
  if (!heading || !fenceLine) return [];
  // The front-matter is the lines between its fences, and its closing fence.
  const front = kind === "markdown" ? frontMatterLines(content) : null;
  const bodyStart = front ? front.length + 2 : 0;

  const headings: Heading[] = [];
  let fence: { char: string; length: number } | null = null;
  let start = 0;
  for (let line = 0; ; line++) {
    const lineBreak = content.indexOf("\n", start);
    const end = lineBreak < 0 ? content.length : lineBreak;

    // Only a line that starts like a heading or a fence can be one, so the
    // rest are not even cut out of the document.
    if (line >= bodyStart && LINE_STARTS.includes(content[start])) {
      const text = content.slice(start, end > start && content[end - 1] === "\r" ? end - 1 : end);
      const marker = fenceLine.exec(text);
      if (fence) {
        // Closed by the same character, at least as many, and nothing after.
        if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
          fence = null;
        }
      } else if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
        // A backtick fence's info string cannot hold a backtick: with one it
        // is inline code, not a fence.
        fence = { char: marker[1][0], length: marker[1].length };
      } else {
        const match = heading.exec(text);
        if (match) headings.push({ level: match[1].length, text: match[2].trim(), line });
      }
    }

    if (lineBreak < 0) break;
    start = lineBreak + 1;
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
