// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("latexEngine loader", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = "";
    const win = window as Window & {
      __meditorPdfTeXEngine?: unknown;
      __meditorPdfTeXWorkerUrl?: string;
    };
    delete win.__meditorPdfTeXEngine;
    delete win.__meditorPdfTeXWorkerUrl;
  });

  it("resolves the worker beside the app base instead of the current route", async () => {
    const fakeEngine = class {};
    const appendScript = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation((node) => {
        const script = node as HTMLScriptElement;
        const win = window as Window & {
          __meditorPdfTeXEngine?: unknown;
        };
        win.__meditorPdfTeXEngine = fakeEngine;
        script.onload?.(new Event("load"));
        return node;
      });

    const { getLatexEngineClass, normalizeTexliveEndpoint } = await import(
      "./latexEngine"
    );
    const loaded = await getLatexEngineClass();
    const win = window as Window & {
      __meditorPdfTeXWorkerUrl?: string;
      __meditorTexliveEndpoint?: string;
    };

    expect(loaded).toBe(fakeEngine);
    expect(win.__meditorPdfTeXWorkerUrl).toBe(
      new URL("swiftlatex/swiftlatexpdftex.js", document.baseURI).href,
    );
    expect(win.__meditorTexliveEndpoint).toBe(
      "https://texlive2.swiftlatex.com/",
    );
    expect(normalizeTexliveEndpoint(" http://127.0.0.1:5000")).toBe(
      "http://127.0.0.1:5000/",
    );
    expect(normalizeTexliveEndpoint(" ")).toBe(
      "https://texlive2.swiftlatex.com/",
    );
    expect(appendScript).toHaveBeenCalledTimes(1);
    expect((appendScript.mock.calls[0][0] as HTMLScriptElement).src).toBe(
      new URL("swiftlatex/PdfTeXEngine.js", document.baseURI).href,
    );
    appendScript.mockRestore();
  });

  it("builds the format only after the generated format is missing", async () => {
    let compileCount = 0;
    let formatCount = 0;
    const events: string[] = [];
    const fakeEngine = class {
      async loadEngine() {
        events.push("load");
      }
      async compileFormat() {
        formatCount += 1;
        events.push("format");
      }
      flushCache() {
        events.push("flush");
      }
      writeMemFSFile() {
        events.push("write");
      }
      setEngineMainFile() {
        events.push("main");
      }
      async compileLaTeX() {
        compileCount += 1;
        events.push("compile");
        return compileCount === 1
          ? { status: 1, log: "I can't find the format file 'swiftlatexpdftex.fmt'!" }
          : { status: 0, log: "ok", pdf: new Uint8Array([37, 80, 68, 70, 45]) };
      }
      closeWorker() {}
    };
    const appendScript = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation((node) => {
        const script = node as HTMLScriptElement;
        const win = window as Window & { __meditorPdfTeXEngine?: unknown };
        win.__meditorPdfTeXEngine = fakeEngine;
        script.onload?.(new Event("load"));
        return node;
      });

    const { compileLatexToPdf } = await import("./latexEngine");
    const pdf = await compileLatexToPdf("\\documentclass{article}");

    expect([...pdf]).toEqual([37, 80, 68, 70, 45]);
    expect(compileCount).toBe(2);
    expect(formatCount).toBe(1);
    expect(events).toEqual([
      "load",
      "write",
      "main",
      "compile",
      "format",
      "flush",
      "write",
      "main",
      "compile",
    ]);
    expect(appendScript).toHaveBeenCalledTimes(1);
    appendScript.mockRestore();
  });
});
