/**
 * A Marp deck is ordinary Markdown that opts in through YAML front-matter
 * (`marp: true`), so it keeps the `.md` extension and the Markdown editor
 * language — only the rendering changes. Detection therefore reads the source
 * rather than the path, and must not misfire on a plain leading `---` rule or
 * on front-matter that does not ask for Marp.
 */

// YAML requires whitespace after the colon, so `marp:true` is not a mapping.
const MARP_KEY = /^\s*marp\s*:[ \t]+["']?true["']?\s*(?:#.*)?$/i;

/** True when the document opts into Marp via `marp: true` front-matter. */
export function isMarpDocument(content: string): boolean {
  const src = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = src.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") return false;

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || trimmed === "...") {
      return lines.slice(1, i).some((line) => MARP_KEY.test(line));
    }
  }
  // A leading rule that is never closed is not front-matter at all.
  return false;
}
