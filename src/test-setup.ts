import { vi } from "vitest";

// Stub codemirror-lang-typst exports so tests don't load WASM or Lezer.
vi.mock("codemirror-lang-typst", () => ({
  typst: () => [],
  typst_lezer: () => [],
}));

// Stub @myriaddreamin/typst.ts — its WASM compiler (~3 MB) is irrelevant
// for unit tests (TypstPreview is lazy-loaded and never rendered in tests).
vi.mock("@myriaddreamin/typst.ts", () => ({
  $typst: {
    svg: async () => "<svg></svg>",
    pdf: async () => new Uint8Array(),
  },
}));
