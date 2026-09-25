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
 * happens to be, and anything else — nesting, block scalars — is left alone
 * rather than half-parsed. The one exception is a list of scalars, the two
 * shapes a person writes by hand, for the keys Pandoc gives lists to
 * (`frontMatterList`). A `style: |` payload that mentions `title:` on an
 * indented line must not be mistaken for a title, so keys are required to
 * start at column zero.
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
    return scalar(match[1]) || null;
  }
  return null;
}

/** A value as written, without its comment and its quotes. */
function scalar(raw: string): string {
  return (
    raw
      // A trailing comment is not part of the value. Written this way it also
      // takes a `#` that begins the value, which is a comment too.
      .replace(/\s*#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim()
  );
}

/**
 * A top-level value that may be a list, as its items, or `null` when the key
 * is not there or holds nothing.
 *
 * Pandoc's `author` and `keywords` are lists as often as not, written one of
 * two ways: a flow sequence on the key's own line, `keywords: [pdf, marcas]`,
 * or a block sequence right under it, one `- item` a line. A single scalar is
 * a list of one. Anything deeper — an author as a mapping, with `name:` and
 * `affiliation:` — is left alone, as the rest of this file leaves it.
 */
export function frontMatterList(content: string, key: string): string[] | null {
  const lines = frontMatterLines(content);
  if (!lines) return null;
  const re = new RegExp(`^${key}[ \\t]*:(.*)$`, "i");
  const at = lines.findIndex((line) => re.test(line));
  if (at < 0) return null;
  const rest = (lines[at].match(re)?.[1] ?? "").replace(/\s*#.*$/, "").trim();
  let items: string[];
  if (rest.startsWith("[") && rest.endsWith("]")) {
    items = flowItems(rest.slice(1, -1));
  } else if (rest) {
    items = [rest];
  } else {
    items = [];
    for (const line of lines.slice(at + 1)) {
      const item = /^\s*-\s+(.+)$/.exec(line);
      if (!item) break;
      items.push(item[1]);
    }
  }
  const values = items.map(scalar).filter(Boolean);
  return values.length ? values : null;
}

/** The items of a flow sequence's inside, split at commas outside quotes. */
function flowItems(inside: string): string[] {
  const items: string[] = [];
  let quote: string | null = null;
  let current = "";
  for (const c of inside) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  items.push(current);
  return items;
}

/** True when a top-level key is present and reads as `true`. */
export function frontMatterFlag(content: string, key: string): boolean {
  return (frontMatterValue(content, key) ?? "").toLowerCase() === "true";
}
