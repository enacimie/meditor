import type { Theme } from "./components/types";

/**
 * Which of Mermaid's own themes a diagram should be drawn with.
 *
 * Only two of them are used. Mermaid ships several, but a document is not a
 * place for a second palette: "default" is the light one every printed page
 * wants, and "dark" is the one that makes a diagram legible on a dark screen.
 */
export type MermaidTheme = "default" | "dark";

/** Where the diagram is going to be looked at. */
export type DiagramSurface =
  /** The web preview — the app's own theme applies. */
  | "screen"
  /** A page: the Document view, a PDF, an exported file, a slide. */
  | "paper";

/**
 * Paper is always paper.
 *
 * The Document view draws A4 sheets, the PDF is printed from them, and the
 * HTML export opens on a white page in someone else's browser. A diagram in
 * dark colours would be a black rectangle in the middle of a white sheet, and
 * on paper it would empty a printer cartridge to say so. None of those follow
 * the interface theme, so neither do their diagrams.
 *
 * On screen the app's theme decides, with one exception. The high-contrast
 * theme keeps the light diagram on the white surface it is given: that pairing
 * was measured to WCAG AA, and Mermaid's dark theme is a palette nobody has
 * checked against the same bar.
 */
export function mermaidThemeFor(
  theme: Theme,
  surface: DiagramSurface,
  prefersDark: boolean,
): MermaidTheme {
  if (surface === "paper") return "default";
  if (theme === "dark") return "dark";
  if (theme === "system" && prefersDark) return "dark";
  return "default";
}

/** Whether the browser is currently asking for a dark interface. */
export function prefersDarkScheme(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
