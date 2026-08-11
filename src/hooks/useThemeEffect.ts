import { useEffect } from "react";
import type { Theme } from "../components/types";

/**
 * Applies the current theme to document.documentElement.
 *
 * Sets data-theme attribute, color-scheme style, and meta theme-color.
 * When theme is "system", listens for prefers-color-scheme changes.
 */
export function useThemeEffect(theme: Theme): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const dark =
        theme === "dark" ||
        theme === "contrast" ||
        (theme === "system" && media.matches);

      // Always set data-theme so CSS selectors can use simple attribute
      // selectors instead of :not() chains for the system/dark fallback.
      root.dataset.theme = theme;
      if (theme === "contrast") {
        root.style.colorScheme = "light";
      } else if (theme === "system") {
        root.style.colorScheme = "light dark";
      } else {
        root.style.colorScheme = theme;
      }

      const meta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]',
      );
      meta?.setAttribute("content", dark ? "#1e1e1e" : "#0969da");
    };

    apply();
    if (theme !== "system") return;

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
