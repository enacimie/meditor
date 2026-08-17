// Typst WASM engine — lazy API around a statically configured singleton.
// The WASM URLs are imported in typstSetup.ts so Vite can package them and
// the runtime can keep a strict CSP without unsafe-eval.

import { $typst } from "./typstSetup";

type TypstModule = { $typst: typeof $typst };
let typstModule: Promise<TypstModule> | null = null;

export function getTypst(): Promise<TypstModule> {
  typstModule ??= Promise.resolve({ $typst });
  return typstModule;
}
