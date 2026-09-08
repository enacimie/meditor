/**
 * A Marp deck is ordinary Markdown that opts in through YAML front-matter
 * (`marp: true`), so it keeps the `.md` extension and the Markdown editor
 * language — only the rendering changes. Detection therefore reads the source
 * rather than the path, and must not misfire on a plain leading `---` rule or
 * on front-matter that does not ask for Marp.
 */

import { frontMatterFlag } from "./frontMatter";

/**
 * True when the document opts into Marp via `marp: true` front-matter.
 *
 * The reading of the block itself lives in `frontMatter.ts`, shared with the
 * presentation directives and the markdown rule, so the three cannot drift
 * apart on what counts as front-matter.
 */
export function isMarpDocument(content: string): boolean {
  return frontMatterFlag(content, "marp");
}
