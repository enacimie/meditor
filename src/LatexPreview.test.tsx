// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationFn } from "./i18n/translations";
import LatexPreview from "./LatexPreview";

const latexEngineMock = vi.hoisted(() => ({
  getLatexEngineClass: vi.fn(),
}));

vi.mock("./latexEngine", () => latexEngineMock);

const t = ((key: string) => key) as TranslationFn;

type MockEngine = {
  loadEngine: ReturnType<typeof vi.fn>;
  compileFormat: ReturnType<typeof vi.fn>;
  writeMemFSFile: ReturnType<typeof vi.fn>;
  setEngineMainFile: ReturnType<typeof vi.fn>;
  compileLaTeX: ReturnType<typeof vi.fn>;
  flushCache: ReturnType<typeof vi.fn>;
  closeWorker: ReturnType<typeof vi.fn>;
};

function makeEngine(pdf: Uint8Array = new Uint8Array([37, 80, 68, 70, 45])): MockEngine {
  return {
    loadEngine: vi.fn().mockResolvedValue(undefined),
    compileFormat: vi.fn().mockResolvedValue(undefined),
    writeMemFSFile: vi.fn(),
    setEngineMainFile: vi.fn(),
    compileLaTeX: vi.fn().mockResolvedValue({ status: 0, log: "ok", pdf }),
    flushCache: vi.fn(),
    closeWorker: vi.fn(),
  };
}

function renderPreview(value = "\\documentclass{article}") {
  return render(
    <LatexPreview value={value} t={t} onReverseSync={vi.fn()} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  latexEngineMock.getLatexEngineClass.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:meditor-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LatexPreview WASM lifecycle", () => {
  it("revokes the previous PDF blob when the source is cleared", async () => {
    const engine = makeEngine();
    latexEngineMock.getLatexEngineClass.mockResolvedValue(
      class {
        loadEngine = engine.loadEngine;
        compileFormat = engine.compileFormat;
        writeMemFSFile = engine.writeMemFSFile;
        setEngineMainFile = engine.setEngineMainFile;
        compileLaTeX = engine.compileLaTeX;
        flushCache = engine.flushCache;
        closeWorker = engine.closeWorker;
      },
    );

    const view = renderPreview();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(screen.getByTitle("LaTeX PDF preview")).toBeDefined();
    expect(engine.compileFormat).not.toHaveBeenCalled();

    const revoke = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
    view.rerender(
      <LatexPreview value="" t={t} onReverseSync={vi.fn()} />,
    );

    expect(revoke).toHaveBeenCalledWith("blob:meditor-test");
    expect(screen.queryByTitle("LaTeX PDF preview")).toBeNull();
  });

  it("clears the stale PDF and exposes a retryable error when package resolution fails", async () => {
    const engine = makeEngine();
    engine.compileLaTeX
      .mockResolvedValueOnce({ status: 0, log: "ok", pdf: new Uint8Array([37, 80, 68, 70, 45]) })
      .mockResolvedValueOnce({ status: -1, log: "TexLive Download Failed", pdf: undefined });
    latexEngineMock.getLatexEngineClass.mockResolvedValue(
      class {
        loadEngine = engine.loadEngine;
        compileFormat = engine.compileFormat;
        writeMemFSFile = engine.writeMemFSFile;
        setEngineMainFile = engine.setEngineMainFile;
        compileLaTeX = engine.compileLaTeX;
        flushCache = engine.flushCache;
        closeWorker = engine.closeWorker;
      },
    );

    const view = renderPreview();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(screen.getByTitle("LaTeX PDF preview")).toBeDefined();

    view.rerender(
      <LatexPreview value="updated source" t={t} onReverseSync={vi.fn()} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    expect(screen.queryByTitle("LaTeX PDF preview")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "TexLive Download Failed",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:meditor-test");
  });

  it("builds the format only after pdfTeX reports it is missing", async () => {
    const engine = makeEngine();
    engine.compileLaTeX
      .mockResolvedValueOnce({
        status: 1,
        log: "I can't find the format file 'swiftlatexpdftex.fmt'!",
        pdf: undefined,
      })
      .mockResolvedValueOnce({
        status: 0,
        log: "ok",
        pdf: new Uint8Array([37, 80, 68, 70, 45]),
      });
    latexEngineMock.getLatexEngineClass.mockResolvedValue(
      class {
        loadEngine = engine.loadEngine;
        compileFormat = engine.compileFormat;
        writeMemFSFile = engine.writeMemFSFile;
        setEngineMainFile = engine.setEngineMainFile;
        compileLaTeX = engine.compileLaTeX;
        flushCache = engine.flushCache;
        closeWorker = engine.closeWorker;
      },
    );

    renderPreview();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    expect(engine.compileFormat).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("LaTeX PDF preview")).toBeDefined();
  });

  it("closes a worker when WASM initialization fails", async () => {
    const engine = makeEngine();
    engine.loadEngine.mockRejectedValue(new Error("WASM init failed"));
    latexEngineMock.getLatexEngineClass.mockResolvedValue(
      class {
        loadEngine = engine.loadEngine;
        compileFormat = engine.compileFormat;
        writeMemFSFile = engine.writeMemFSFile;
        setEngineMainFile = engine.setEngineMainFile;
        compileLaTeX = engine.compileLaTeX;
        flushCache = engine.flushCache;
        closeWorker = engine.closeWorker;
      },
    );

    renderPreview();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    expect(screen.getByRole("alert")).toBeDefined();
    expect(engine.closeWorker).toHaveBeenCalledTimes(1);
  });

  it("closes the engine worker when the preview unmounts", async () => {
    const engine = makeEngine();
    latexEngineMock.getLatexEngineClass.mockResolvedValue(
      class {
        loadEngine = engine.loadEngine;
        compileFormat = engine.compileFormat;
        writeMemFSFile = engine.writeMemFSFile;
        setEngineMainFile = engine.setEngineMainFile;
        compileLaTeX = engine.compileLaTeX;
        flushCache = engine.flushCache;
        closeWorker = engine.closeWorker;
      },
    );

    const view = renderPreview();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(engine.closeWorker).toHaveBeenCalledTimes(1);
  });
});
