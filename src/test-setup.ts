import { vi } from "vitest";

// Stub codemirror-lang-typst exports so tests don't load WASM or Lezer.
vi.mock("codemirror-lang-typst", () => ({
  typst: () => [],
  typst_lezer: () => [],
}));
