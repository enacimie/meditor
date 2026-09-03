/**
 * Map each slide of a Marp deck to the source line it starts on, so the
 * preview can sync back to the editor at slide granularity.
 *
 * Marp (Marpit) breaks slides on thematic breaks — the `---` lines after the
 * YAML front-matter. Counting them faithfully means skipping the front-matter
 * itself, ignoring `---` inside fenced code, and accepting every CommonMark
 * thematic-break spelling (`---`, `***`, `___`, spaced variants).
 */

const THEMATIC_BREAK = /^\s{0,3}((?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function slideStartLines(content: string): number[] {
  const src = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = src.split(/\r?\n/);

  let index = 0;
  if (lines.length && lines[0].trim() === "---") {
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "---" || t === "...") {
        index = j + 1;
        break;
      }
    }
  }

  const starts: number[] = [Math.min(index, Math.max(lines.length - 1, 0))];
  let fence: string | null = null;
  for (let k = index; k < lines.length; k++) {
    const line = lines[k];
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (!fence && THEMATIC_BREAK.test(line)) starts.push(k + 1);
  }
  return starts;
}
