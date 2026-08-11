/**
 * Available visual themes.
 *
 * - `system`: Follows the OS-level `prefers-color-scheme` media query.
 * - `light` / `dark`: Explicit light or dark mode.
 * - `contrast`: High-contrast accessibility theme with maximum WCAG ratios.
 */
export type Theme = "system" | "light" | "dark" | "contrast";

/**
 * Ephemeral notification shown in the top bar.
 *
 * - `kind`: Visual treatment (info = neutral, success = green, error = red).
 * - `message`: Localized text to display.
 */
export type Notice = {
  kind: "info" | "success" | "error";
  message: string;
};
