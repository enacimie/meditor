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
  const lines = withoutBom(content).split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || trimmed === "...") return lines.slice(1, i);
  }
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
