import { describe, it, expect } from "vitest";
import { mermaidThemeFor } from "./mermaidTheme";

/**
 * Which theme a diagram is drawn with, per surface.
 *
 * The rule that matters is not "follow the app" — it is that only one of the
 * places a diagram appears follows the app at all. Everything else is paper,
 * and a dark diagram on paper is a black rectangle in the middle of a white
 * sheet, or a spent printer cartridge.
 */
describe("mermaidThemeFor", () => {
  describe("on paper", () => {
    it("stays light whatever the app is wearing", () => {
      // The Document view, the PDF printed from it, the HTML export and a
      // Marp slide all end up here.
      for (const theme of ["light", "dark", "contrast", "system"] as const) {
        expect(mermaidThemeFor(theme, "paper", true), theme).toBe("default");
        expect(mermaidThemeFor(theme, "paper", false), theme).toBe("default");
      }
    });
  });

  describe("on screen", () => {
    it("follows the dark theme", () => {
      expect(mermaidThemeFor("dark", "screen", false)).toBe("dark");
    });

    it("stays light on the light theme", () => {
      expect(mermaidThemeFor("light", "screen", true)).toBe("default");
    });

    it("follows the system theme in both directions", () => {
      expect(mermaidThemeFor("system", "screen", true)).toBe("dark");
      expect(mermaidThemeFor("system", "screen", false)).toBe("default");
    });

    it("leaves the contrast theme its measured pairing", () => {
      // High contrast keeps the light diagram on the white surface it is
      // given: that combination was measured to WCAG AA, and Mermaid's dark
      // palette has not been. Following the app here would swap a checked
      // contrast ratio for an unchecked one.
      expect(mermaidThemeFor("contrast", "screen", true)).toBe("default");
      expect(mermaidThemeFor("contrast", "screen", false)).toBe("default");
    });
  });
});
