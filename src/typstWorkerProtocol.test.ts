/**
 * What the Typst worker answers, without a worker or a compiler.
 */
import { describe, expect, it, vi } from "vitest";
import {
  answer,
  oneAtATime,
  serve,
  type TypstReply,
  type TypstRequest,
  type TypstSnippet,
  type WorkerScope,
} from "./typstWorkerProtocol";

const request = (kind: TypstRequest["kind"], more: Partial<TypstRequest> = {}): TypstRequest => ({
  id: 7,
  kind,
  mainContent: "= Hello",
  fontBase: "https://app.example/meditor/",
  ...more,
});

/** A stand-in for typst.ts's snippet that keeps a log of what it was asked, in order. */
function compiler(overrides: Partial<TypstSnippet> = {}) {
  const log: string[] = [];
  const typst: TypstSnippet = {
    svg: vi.fn(async (options) => {
      log.push(`svg ${JSON.stringify(options)}`);
      return "<svg/>";
    }),
    pdf: vi.fn(async (options) => {
      log.push(`pdf ${JSON.stringify(options)}`);
      return new Uint8Array([37, 80, 68, 70, 45]);
    }),
    addSource: vi.fn(async (path) => void log.push(`addSource ${path}`)),
    mapShadow: vi.fn(async (path) => void log.push(`mapShadow ${path}`)),
    unmapShadow: vi.fn(async (path) => void log.push(`unmapShadow ${path}`)),
    resetShadow: vi.fn(async () => void log.push("resetShadow")),
    ...overrides,
  };
  return { typst, log };
}

describe("the Typst worker's answer", () => {
  it("is the request's source as SVG, under the request's id", async () => {
    const { typst } = compiler();
    const { reply, transfer } = await answer(typst, request("svg"));
    expect(typst.svg).toHaveBeenCalledWith({ mainContent: "= Hello" });
    expect(typst.pdf).not.toHaveBeenCalled();
    expect(reply).toEqual({ id: 7, svg: "<svg/>" });
    expect(transfer).toEqual([]);
  });

  it("is the PDF's bytes, moved to the page rather than copied", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    const { typst } = compiler({ pdf: vi.fn(async () => bytes) });
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
    const { typst } = compiler({ pdf: vi.fn(async () => undefined) });
    const { reply, transfer } = await answer(typst, request("pdf"));
    expect(reply).toEqual({ id: 7, pdf: undefined });
    expect(transfer).toEqual([]);
  });

  it("carries the compiler's error as the text it would have shown", async () => {
    const { typst } = compiler({ svg: vi.fn(async () => Promise.reject(new Error("unknown variable: x"))) });
    const { reply, transfer } = await answer(typst, request("svg"));
    expect(reply).toEqual({ id: 7, error: "unknown variable: x" });
    expect(transfer).toEqual([]);
  });

  it("carries an error thrown as a bare string too", async () => {
    const { typst } = compiler({ pdf: vi.fn(async () => Promise.reject("expected expression")) });
    const { reply } = await answer(typst, request("pdf"));
    expect(reply).toEqual({ id: 7, error: "expected expression" });
  });

  it("compiles a document with a folder from its own path there, with the folder as the root", async () => {
    const { typst, log } = compiler();
    await answer(typst, request("svg", { mainPath: "/report.typ" }));
    expect(log).toEqual([
      "addSource /report.typ",
      `svg ${JSON.stringify({ mainFilePath: "/report.typ", root: "/" })}`,
    ]);
    expect(typst.addSource).toHaveBeenCalledWith("/report.typ", "= Hello");
  });

  it("takes out the files no longer read and puts in those that changed, before compiling", async () => {
    const { typst, log } = compiler();
    const figure = new Uint8Array([1, 2, 3]);
    await answer(
      typst,
      request("pdf", {
        mainPath: "/report.typ",
        files: { reset: false, set: [{ path: "/figure.png", bytes: figure }], drop: ["/old.png"] },
      }),
    );
    expect(log).toEqual([
      "unmapShadow /old.png",
      "mapShadow /figure.png",
      "addSource /report.typ",
      `pdf ${JSON.stringify({ mainFilePath: "/report.typ", root: "/" })}`,
    ]);
    expect(typst.mapShadow).toHaveBeenCalledWith("/figure.png", figure);
  });

  it("starts from an empty folder when the files held are another document's", async () => {
    const { typst, log } = compiler();
    await answer(typst, request("svg", { mainPath: "/b.typ", files: { reset: true, set: [], drop: [] } }));
    expect(log[0]).toBe("resetShadow");
    const { typst: again, log: kept } = compiler();
    await answer(again, request("svg", { mainPath: "/b.typ", files: { reset: false, set: [], drop: [] } }));
    expect(kept).not.toContain("resetShadow");
  });
});

describe("the worker's requests", () => {
  it("are answered one at a time: the next one's files wait for this one's compile", async () => {
    let finish!: () => void;
    const { typst, log } = compiler({
      svg: vi.fn(() => new Promise<string>((resolve) => (finish = () => resolve("<svg/>")))),
    });
    const respond = oneAtATime((next) => answer(typst, next));
    const first = respond(request("svg", { mainPath: "/a.typ" }));
    const second = respond(
      request("svg", { id: 8, mainPath: "/b.typ", files: { reset: true, set: [], drop: [] } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual(["addSource /a.typ"]);
    finish();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log.slice(1, 3)).toEqual(["resetShadow", "addSource /b.typ"]);
    finish();
    expect((await second).reply).toEqual({ id: 8, svg: "<svg/>" });
  });

  it("go on after one fails", async () => {
    let calls = 0;
    const respond = oneAtATime(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { reply: { id: 2, svg: "<svg/>" }, transfer: [] };
    });
    await expect(respond(request("svg"))).rejects.toThrow("boom");
    expect((await respond(request("svg", { id: 2 }))).reply).toEqual({ id: 2, svg: "<svg/>" });
  });
});

describe("the worker", () => {
  /** A stand-in for the worker's global scope: requests in, replies out. */
  function workerScope() {
    let listener: ((event: MessageEvent<TypstRequest>) => void) | null = null;
    const posted: Array<{ message: TypstReply; transfer: Transferable[] }> = [];
    const scope: WorkerScope = {
      addEventListener: (_type, added) => {
        listener = added;
      },
      postMessage: (message, transfer) => void posted.push({ message, transfer }),
    };
    const send = (sent: TypstRequest) => listener!({ data: sent } as MessageEvent<TypstRequest>);
    return { scope, posted, send };
  }

  it("answers a request that fails before the compiler is reached, and the next one too", async () => {
    const { scope, posted, send } = workerScope();
    const { typst } = compiler();
    let asked = 0;
    serve(scope, () => {
      asked++;
      if (asked === 1) throw new Error("no compiler");
      return typst;
    });
    send(request("svg", { id: 1 }));
    send(request("svg", { id: 2 }));
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((entry) => entry.message)).toEqual([
      { id: 1, error: "no compiler" },
      { id: 2, svg: "<svg/>" },
    ]);
  });

  it("moves a PDF's bytes to the page along with the reply", async () => {
    const { scope, posted, send } = workerScope();
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    const { typst } = compiler({ pdf: vi.fn(async () => bytes) });
    serve(scope, () => typst);
    send(request("pdf"));
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].message).toEqual({ id: 7, pdf: bytes });
    expect(posted[0].transfer).toEqual([bytes.buffer]);
  });
});
