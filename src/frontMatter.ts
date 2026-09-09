/**
 * The YAML front-matter block at the top of a document, read once.
 *
 * Three places already needed it and each had grown its own reader: Marp
 * detection (`marp: true`), the presentation directives (`transition:`), and
 * the markdown rule that keeps the block out of the rendered output. They
 * agreed on the shape of front-matter by coincidence rather than by sharing a
 * definition, which is the kind of agreement that stops being true quietly.
 *
 * Deliberately not a YAML parser. What is understood here is a top-level
 * mapping of scalars, which is what every directive this application reads
 * happens to be, and anything else — nesting, block scalars, flow sequences —
 * is left alone rather than half-parsed. A `style: |` payload that mentions
 * `title:` on an indented line must not be mistaken for a title, so keys are
 * required to start at column zero.
 */

/** Strip a byte-order mark, which otherwise hides the opening `---`. */
function withoutBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * The lines between the fences, or `null` when the document has no
 * front-matter.
 *
 * A leading `---` that is never closed is a horizontal rule, not front-matter,
 * and answering `null` for it is what keeps an ordinary document that opens
 * with a rule from being read as configuration.
 */
export function frontMatterLines(content: string): string[] | null {
  /*
   * Walked line by line rather than split.
   *
   * It used to `split(/\r?\n/)` the whole document before looking at even the
   * first line, and this is called four times on every keystroke — twice for
   * the page geometry, once for Marp detection in App and once more in
   * Preview. On a small document that is nothing; measured on a 5.75 MB one
   * it was 17 ms a call, so 67 ms of every keypress went on cutting up text
   * that was going to be thrown away. `App.tsx` states the rule twenty lines
   * above the callers — parsing the whole document belongs off the keystroke
   * path — and this was quietly breaking it.
   *
   * Now the work is proportional to the front-matter rather than to the
   * document: a file that does not open with `---` costs one `indexOf`.
   */
  const text = withoutBom(content);
  const lines: string[] = [];
  let start = 0;
  let firstLine = true;

  for (;;) {
    const lineBreak = text.indexOf("\n", start);
    const end = lineBreak < 0 ? text.length : lineBreak;
    // The `\r` of a CRLF file belongs to the break, not to the line. `split`
    // took it off; taking it off here keeps every caller's regexes anchored
    // where they were.
    const line = text.slice(start, end > start && text[end - 1] === "\r" ? end - 1 : end);
    const trimmed = line.trim();

    if (firstLine) {
      if (trimmed !== "---") return null;
      firstLine = false;
    } else if (trimmed === "---" || trimmed === "...") {
      return lines;
    } else {
      lines.push(line);
    }

    if (lineBreak < 0) break;
    start = lineBreak + 1;
  }
  // Never closed, so it was a horizontal rule after all.
  return null;
}

/**
 * One top-level value, or `null`.
 *
 * The key must start at column zero and be followed by a colon and at least
 * one space — YAML requires the space, so `marp:true` is a scalar string and
 * not a mapping, and treating it as one would opt a document into Marp that
 * never asked.
 */
export function frontMatterValue(content: string, key: string): string | null {
  const lines = frontMatterLines(content);
  if (!lines) return null;
  const re = new RegExp(`^${key}[ \\t]*:[ \\t]+(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(re);
    if (!match) continue;
    const value = match[1]
      // A trailing comment is not part of the value. Written this way it also
      // takes a `#` that begins the value, which is a comment too.
      .replace(/\s*#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    return value || null;
  }
  return null;
}

/** True when a top-level key is present and reads as `true`. */
export function frontMatterFlag(content: string, key: string): boolean {
  return (frontMatterValue(content, key) ?? "").toLowerCase() === "true";
}
