/**
 * The Android build exposes the system window insets (status bar, gesture bar,
 * display cutout) through a JS interface, because wry/Tauri do not hand them
 * to the web layer. Copy them into CSS custom properties so the stylesheets
 * can pad the top bar and status bar away from the system UI.
 *
 * iOS and the desktop have no bridge; their styles fall back to the
 * `env(safe-area-inset-*)` values declared on `:root`.
 */
export function applyAndroidSafeArea(): void {
  const bridge = (
    window as unknown as {
      MeditorSafeArea?: {
        top: () => number;
        bottom: () => number;
        left: () => number;
        right: () => number;
      };
    }
  ).MeditorSafeArea;
  if (!bridge) return;
  const style = document.documentElement.style;
  style.setProperty("--safe-area-top", `${bridge.top()}px`);
  style.setProperty("--safe-area-bottom", `${bridge.bottom()}px`);
  style.setProperty("--safe-area-left", `${bridge.left()}px`);
  style.setProperty("--safe-area-right", `${bridge.right()}px`);
}
