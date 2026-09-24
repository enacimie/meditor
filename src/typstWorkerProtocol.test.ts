/**
 * What the Typst worker answers, without a worker or a compiler.
 */
import { describe, expect, it, vi } from "vitest";
import { answer, type TypstApi, type TypstRequest } from "./typstWorkerProtocol";

const request = (kind: TypstRequest["kind"]): TypstRequest => ({
  id: 7,
  kind,
  mainContent: "= Hello",
  fontBase: "https://app.example/meditor/",
});

function compiler(overrides: Partial<TypstApi> = {}): TypstApi {
  return {
    svg: vi.fn(async () => "<svg/>"),
    pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45])),
    ...overrides,
  };
}

describe("the Typst worker's answer", () => {
  it("is the request's source as SVG, under the request's id", async () => {
    const typst = compiler();
    const { reply, transfer } = await answer(typst, request("svg"));
    expect(typst.svg).toHaveBeenCalledWith({ mainContent: "= Hello" });
    expect(typst.pdf).not.toHaveBeenCalled();
    expect(reply).toEqual({ id: 7, svg: "<svg/>" });
    expect(transfer).toEqual([]);
  });

  it("is the PDF's bytes, moved to the page rather than copied", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    const typst = compiler({ pdf: vi.fn(async () => bytes) });
    const { reply, transfer } = await answer(typst, request("pdf"));
    expect(typst.pdf).toHaveBeenCalledWith({ mainContent: "= Hello" });
    expect(typst.svg).not.toHaveBeenCalled();
    // What postMessage does with the pair: the copy arrives whole, and the
    // worker is left without its own.
    const received = structuredClone(reply, { transfer }) as { id: number; pdf: Uint8Array };
    expect(received.id).toBe(7);
    expect([...received.pdf]).toEqual([37, 80, 68, 70, 45]);
    expect(bytes.byteLength).toBe(0);
  });

  it("has nothing to move when the compiler made no PDF", async () => {
    const typst = compiler({ pdf: vi.fn(async () => undefined) });
    const { reply, transfer } = await answer(typst, request("pdf"));
    expect(reply).toEqual({ id: 7, pdf: undefined });
    expect(transfer).toEqual([]);
  });

  it("carries the compiler's error as the text it would have shown", async () => {
    const typst = compiler({ svg: vi.fn(async () => Promise.reject(new Error("unknown variable: x"))) });
    const { reply, transfer } = await answer(typst, request("svg"));
    expect(reply).toEqual({ id: 7, error: "unknown variable: x" });
    expect(transfer).toEqual([]);
  });

  it("carries an error thrown as a bare string too", async () => {
    const typst = compiler({ pdf: vi.fn(async () => Promise.reject("expected expression")) });
    const { reply } = await answer(typst, request("pdf"));
    expect(reply).toEqual({ id: 7, error: "expected expression" });
  });
});
