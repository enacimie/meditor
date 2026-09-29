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

/**
 * How the workspace is laid out.
 *
 * - `editor`: only the editor, for writing without the preview alongside.
 * - `split`: editor and preview side by side (the default).
 * - `preview`: only the preview, for reading a document without its source.
 *
 * Zen mode is orthogonal: it always shows the editor alone, and leaving it
 * restores whichever layout was chosen.
 */
export type LayoutMode = "editor" | "split" | "preview";

/**
 * A yes-or-no question on screen, and the answer it is waiting for.
 */
export type ConfirmRequest = {
  // Rises with every question so the dialog remounts instead of swapping
  // its text under whatever the reader had focused. See its `key` in AppDialogs.
  seq: number;
  message: string;
  resolve: (ok: boolean) => void;
};

/**
 * A tab being renamed: which one, the name it has now, and where the new
 * name goes — `null` when the rename is cancelled.
 */
export type RenameRequest = {
  id: string;
  name: string;
  resolve: (name: string | null) => void;
};

/**
 * A file that changed on disk while its tab had edits of its own: which tab,
 * its name, and what the file holds now.
 */
export type ConflictRequest = {
  id: string;
  name: string;
  diskContent: string;
};
