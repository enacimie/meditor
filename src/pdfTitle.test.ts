// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pdfTitle, withDocumentTitle } from "./pdfTitle";

describe("pdfTitle", () => {
  const markdown = (content: string) => ({ kind: "markdown" as const, content, name: "notes.md" });

  it("takes the title the front-matter gives", () => {
    expect(pdfTitle(markdown("---\ntitle: Informe de medición\n---\n\n# Uno\n"))).toBe(
      "Informe de medición",
    );
  });

  it("takes it out of its quotes", () => {
    expect(pdfTitle(markdown('---\ntitle: "Informe: 2026"\n---\n'))).toBe("Informe: 2026");
  });

  it("keeps the tab's name for a document that names no title", () => {
    expect(pdfTitle(markdown("# Introducción\n\nTexto.\n"))).toBe("notes.md");
    expect(pdfTitle(markdown("---\nlang: es\n---\n\n# Introducción\n"))).toBe("notes.md");
  });

  it("reads a Marp deck's title too, which is Markdown", () => {
    expect(pdfTitle(markdown("---\nmarp: true\ntitle: Charla\n---\n\n# Una\n"))).toBe("Charla");
  });

  it("keeps the name of a file that has no front-matter to read", () => {
    const typst = { kind: "typst" as const, content: "---\ntitle: No\n---\n", name: "a.typ" };
    expect(pdfTitle(typst)).toBe("a.typ");
  });
});

describe("withDocumentTitle", () => {
  afterEach(() => {
    document.title = "";
  });

  it("holds the title while the print runs, then puts the old one back", async () => {
    document.title = "notes.md";
    let during = "";
    const result = await withDocumentTitle("Informe", async () => {
      during = document.title;
      return 7;
    });
    expect(during).toBe("Informe");
    expect(result).toBe(7);
    expect(document.title).toBe("notes.md");
  });

  it("puts it back when the print fails, and lets the failure through", async () => {
    document.title = "notes.md";
    await expect(
      withDocumentTitle("Informe", async () => {
        throw new Error("no printer");
      }),
    ).rejects.toThrow("no printer");
    expect(document.title).toBe("notes.md");
  });

  it("leaves a title the application set meanwhile", async () => {
    document.title = "notes.md";
    await withDocumentTitle("Informe", async () => {
      // The reader switched tabs while the PDF was being written.
      document.title = "other.md";
    });
    expect(document.title).toBe("other.md");
  });
});
