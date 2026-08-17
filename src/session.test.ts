import { describe, expect, it } from "vitest";
import { parseSession, serializeSession } from "./session";
import type { Doc } from "./types";

const docs: Doc[] = [
  { id: "one", name: "uno.md", path: "/tmp/uno.md", content: "# Uno", dirty: true, kind: "markdown" },
  { id: "two", name: "Dos", path: null, content: "Texto", dirty: false, kind: "markdown" },
];

describe("session", () => {
  it("serializa y recupera documentos y preferencias", () => {
    const parsed = parseSession(serializeSession(docs, "two", 72));
    expect(parsed).toEqual({ version: 3, docs, activeId: "two", split: 72 });
  });

  it("corrige un documento activo inexistente y limita el divisor", () => {
    const parsed = parseSession(JSON.stringify({ docs, activeId: "missing", split: 999 }));
    expect(parsed?.activeId).toBe("one");
    expect(parsed?.split).toBe(80);
  });

  it("rechaza documentos inválidos, ids duplicados y JSON corrupto", () => {
    const raw = JSON.stringify({
      docs: [docs[0], docs[0], { id: "bad", content: 42 }],
    });
    expect(parseSession(raw)?.docs).toEqual([docs[0]]);
    expect(parseSession("not-json")).toBeNull();
  });

  it("recupera el tipo desde la ruta en sesiones antiguas", () => {
    const legacy = [
      { id: "typ", name: "paper.typ", path: "/tmp/paper.typ", content: "= Title", dirty: false },
      { id: "tex", name: "paper.tex", path: "/tmp/paper.tex", content: "\\documentclass{article}", dirty: false },
    ];
    const parsed = parseSession(JSON.stringify({ version: 2, docs: legacy }));
    expect(parsed?.docs.map((doc) => doc.kind)).toEqual(["typst", "latex"]);
  });

  it("rechaza una sesión con una versión futura o demasiado antigua", () => {
    expect(parseSession(JSON.stringify({ version: 99, docs }))).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, docs }))).toBeNull();
  });
});
