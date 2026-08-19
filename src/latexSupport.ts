// LaTeX support is temporarily disabled.
//
// The bundled SwiftLaTeX engine downloads TeX Live packages from an endpoint
// whose upstream is unmaintained (last commit 2024) and has been down for long
// stretches, so the preview cannot be relied upon. Flip back to `true` when
// the in-house Rust/WASM LaTeX engine replaces it.
export const LATEX_ENABLED = false;
