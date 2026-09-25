import { describe, expect, it } from "vitest";
import { pdfMetadata } from "./pdfMetadata";

const markdown = (content: string) => ({ kind: "markdown" as const, content });

describe("pdfMetadata", () => {
  it("takes the author, subject and keywords the front-matter gives", () => {
    const content =
      "---\ntitle: Informe\nauthor: Ana Pérez\nsubject: Medición\nkeywords: [pdf, marcadores]\n---\n";
    expect(pdfMetadata(markdown(content))).toEqual({
      author: "Ana Pérez",
      subject: "Medición",
      keywords: "pdf, marcadores",
    });
  });

  it("joins several authors the way Pandoc does, so a surname-first name stays one", () => {
    const content = '---\nauthor:\n  - "Pérez, Ana"\n  - Luis Gómez\n---\n';
    expect(pdfMetadata(markdown(content))).toEqual({ author: "Pérez, Ana; Luis Gómez" });
  });

  it("says nothing the document does not", () => {
    expect(pdfMetadata(markdown("---\ntitle: Informe\n---\n\n# Uno\n"))).toEqual({});
    expect(pdfMetadata(markdown("# Uno\n"))).toEqual({});
  });

  it("reads a Marp deck's too, which is Markdown", () => {
    const content = "---\nmarp: true\nauthor: Ana\nkeywords: charla\n---\n\n# Una\n";
    expect(pdfMetadata(markdown(content))).toEqual({ author: "Ana", keywords: "charla" });
  });

  it("reads nothing from a file that has no front-matter to read", () => {
    const typst = { kind: "typst" as const, content: "---\nauthor: No\n---\n" };
    expect(pdfMetadata(typst)).toEqual({});
  });
});
