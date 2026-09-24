/**
 * The page's end of the Typst worker, against a stand-in for the worker.
 */
import { describe, expect, it } from "vitest";
import { createTypstClient, type WorkerLike } from "./typstEngine";
import type { TypstReply, TypstRequest } from "./typstWorkerProtocol";

class FakeWorker implements WorkerLike {
  posted: TypstRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<TypstReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: TypstRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: TypstReply): void {
    this.onmessage?.({ data } as MessageEvent<TypstReply>);
  }

  /** What the page sees when the worker's script fails, or throws outside a request. */
  fail(message?: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const typst = createTypstClient(
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    () => "https://app.example/meditor/",
  );
  return { typst, workers };
}

describe("the Typst client", () => {
  it("starts its worker at the first request, and only once", () => {
    const { typst, workers } = setup();
    expect(workers).toHaveLength(0);
    void typst.svg({ mainContent: "a" });
    void typst.pdf({ mainContent: "b" });
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(2);
  });

  it("sends the source, what to make of it and where the fonts are", async () => {
    const { typst, workers } = setup();
    const svg = typst.svg({ mainContent: "= Hi" });
    const [sent] = workers[0].posted;
    expect(sent).toMatchObject({
      kind: "svg",
      mainContent: "= Hi",
      fontBase: "https://app.example/meditor/",
    });
    workers[0].reply({ id: sent.id, svg: "<svg/>" });
    await expect(svg).resolves.toBe("<svg/>");
  });

  it("gives each request its own reply, in whatever order they come back", async () => {
    const { typst, workers } = setup();
    const svg = typst.svg({ mainContent: "preview" });
    const pdf = typst.pdf({ mainContent: "export" });
    const [first, second] = workers[0].posted;
    expect(first.id).not.toBe(second.id);
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    workers[0].reply({ id: second.id, pdf: bytes });
    workers[0].reply({ id: first.id, svg: "<svg/>" });
    await expect(pdf).resolves.toBe(bytes);
    await expect(svg).resolves.toBe("<svg/>");
  });

  it("fails a request with the compiler's message when that is the answer", async () => {
    const { typst, workers } = setup();
    const svg = typst.svg({ mainContent: "#x" });
    workers[0].reply({ id: workers[0].posted[0].id, error: "unknown variable: x" });
    await expect(svg).rejects.toThrow("unknown variable: x");
  });

  it("fails everything waiting when the worker dies, and starts another for what comes next", async () => {
    const { typst, workers } = setup();
    const svg = typst.svg({ mainContent: "a" });
    const pdf = typst.pdf({ mainContent: "b" });
    workers[0].fail("SyntaxError: Unexpected token");
    await expect(svg).rejects.toThrow("SyntaxError: Unexpected token");
    await expect(pdf).rejects.toThrow("SyntaxError: Unexpected token");
    expect(workers[0].terminated).toBe(true);

    const again = typst.svg({ mainContent: "a" });
    expect(workers).toHaveLength(2);
    workers[1].reply({ id: workers[1].posted[0].id, svg: "<svg/>" });
    await expect(again).resolves.toBe("<svg/>");
  });

  it("says the worker stopped when its failure comes without a message", async () => {
    // A module worker whose script cannot load reports a plain Event.
    const { typst, workers } = setup();
    const svg = typst.svg({ mainContent: "a" });
    workers[0].fail();
    await expect(svg).rejects.toThrow("the Typst worker stopped");
  });

  it("does not let a late failure of a replaced worker fail its successor's requests", async () => {
    const { typst, workers } = setup();
    void typst.svg({ mainContent: "a" }).catch(() => undefined);
    workers[0].fail("first");
    const svg = typst.svg({ mainContent: "a" });
    workers[0].fail("late");
    workers[1].reply({ id: workers[1].posted[0].id, svg: "<svg/>" });
    await expect(svg).resolves.toBe("<svg/>");
    expect(workers[1].terminated).toBe(false);
  });
});

describe("the files the Typst client sends", () => {
  const bytes = (n: number) => new Uint8Array([n]);
  const folder = (id: string, files: Record<string, string>) => ({
    id,
    mainPath: "/report.typ",
    files: new Map(Object.entries(files).map(([path, key]) => [path, { key, bytes: bytes(key.length) }])),
  });
  /** What the request carried: the main path, and the files by path. */
  const carried = (request: TypstRequest) => ({
    mainPath: request.mainPath,
    reset: request.files?.reset,
    set: request.files?.set.map((file) => file.path),
    drop: request.files?.drop,
  });

  it("are all of them the first time, then only what changed or went", () => {
    const { typst, workers } = setup();
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "1", "fig.png": "1" }) });
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "1", "fig.png": "1" }) });
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "2" }) });
    expect(workers[0].posted.map(carried)).toEqual([
      { mainPath: "/report.typ", reset: true, set: ["/a.typ", "/fig.png"], drop: [] },
      { mainPath: "/report.typ", reset: false, set: [], drop: [] },
      { mainPath: "/report.typ", reset: false, set: ["/a.typ"], drop: ["/fig.png"] },
    ]);
  });

  it("start afresh for another document's folder", () => {
    const { typst, workers } = setup();
    void typst.svg({ mainContent: "a", folder: folder("one", { "a.typ": "1" }) });
    void typst.svg({ mainContent: "b", folder: folder("two", { "a.typ": "1" }) });
    expect(carried(workers[0].posted[1])).toEqual({
      mainPath: "/report.typ",
      reset: true,
      set: ["/a.typ"],
      drop: [],
    });
  });

  it("are all sent again to a worker that replaces one that died", async () => {
    const { typst, workers } = setup();
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "1" }) }).catch(() => undefined);
    workers[0].fail("gone");
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "1" }) });
    expect(carried(workers[1].posted[0])).toEqual({
      mainPath: "/report.typ",
      reset: true,
      set: ["/a.typ"],
      drop: [],
    });
  });

  it("are taken away, once, from a document without a folder that follows one with them", () => {
    const { typst, workers } = setup();
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "1" }) });
    void typst.svg({ mainContent: "unsaved" });
    void typst.svg({ mainContent: "unsaved again" });
    void typst.svg({ mainContent: "a", folder: folder("doc", { "a.typ": "1" }) });
    expect(workers[0].posted.slice(1).map(carried)).toEqual([
      { mainPath: undefined, reset: true, set: [], drop: [] },
      { mainPath: undefined, reset: undefined, set: undefined, drop: undefined },
      { mainPath: "/report.typ", reset: true, set: ["/a.typ"], drop: [] },
    ]);
  });

  it("are none, and no path either, for a document without a folder", () => {
    const { typst, workers } = setup();
    void typst.svg({ mainContent: "a" });
    expect(carried(workers[0].posted[0])).toEqual({
      mainPath: undefined,
      reset: undefined,
      set: undefined,
      drop: undefined,
    });
  });
});
