// LaTeX support is temporarily disabled.
//
// The bundled SwiftLaTeX engine downloads TeX Live packages from an endpoint
// whose upstream is unmaintained (last commit 2024) and has been down for long
// stretches, so the preview cannot be relied upon. Flip back to `true` when
// the in-house Rust/WASM LaTeX engine replaces it.
//
// The same flag also keeps the installers from registering .tex/.latex/.ltx
// as meditor documents: set LATEX_ENABLED=true for `pnpm tauri build/dev`, and
// update the LATEX_ENABLED env in .github/workflows/release.yml so the shipped
// bundles layer src-tauri/conf/latex-enabled.json on top of the base config.
export const LATEX_ENABLED = false;
