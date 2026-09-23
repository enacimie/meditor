// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { limitFootnotePages, stopRunawayNotePages } from "./pagedFootnotePages";

type Page = { element?: HTMLElement };

/**
 * paged.js's chunker, as far as note pages go: `clonePage` appends a page,
 * and once it has been laid out the page asks for another if `next` says its
 * notes still overflow — through `chunker.clonePage`, as the footnote module
 * does, so the wrapped version is the one called.
 */
function chunkerWhere(next: (clone: number) => { keeps: string; overflows: boolean }) {
  const chunker = {
    pages: [] as Page[],
    clones: 0,
    clonePage(_page: Page): Promise<unknown> {
      chunker.clones += 1;
      // A safety net for the test itself: a stop that fails must fail the
      // test, not hang it.
      if (chunker.clones > 500) throw new Error("more than 500 note pages");
      const element = document.createElement("div");
      element.innerHTML = '<div class="pagedjs_footnote_inner_content"></div>';
      const created = { element };
      chunker.pages.push(created);
      const { keeps, overflows } = next(chunker.clones);
      element.querySelector(".pagedjs_footnote_inner_content")!.textContent = keeps;
      return (async () => {
        await Promise.resolve();
        if (overflows) await chunker.clonePage(created);
      })();
    },
  };
  return chunker;
}

/** A page of the document, whose notes overflowed. */
function documentPage(chunker: { pages: Page[] }): Page {
  const page = { element: document.createElement("div") };
  chunker.pages.push(page);
  return page;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stopRunawayNotePages", () => {
  it("adds no page after a page of notes that kept none of them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // What froze the CI: every page judges the whole note not to fit.
    const chunker = chunkerWhere(() => ({ keeps: "", overflows: true }));
    stopRunawayNotePages(chunker);
    await chunker.clonePage(documentPage(chunker));
    expect(chunker.clones).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("goes on while each page keeps some of the notes, until they are all placed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunker = chunkerWhere((clone) => ({ keeps: `part ${clone}`, overflows: clone < 3 }));
    stopRunawayNotePages(chunker);
    await chunker.clonePage(documentPage(chunker));
    expect(chunker.clones).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it("cuts a run at its limit even when every page keeps something", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunker = chunkerWhere((clone) => ({ keeps: `part ${clone}`, overflows: true }));
    stopRunawayNotePages(chunker, 5);
    await chunker.clonePage(documentPage(chunker));
    expect(chunker.clones).toBe(5);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("gives each page of the document a run of its own, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunker = chunkerWhere((clone) => ({ keeps: `part ${clone}`, overflows: true }));
    stopRunawayNotePages(chunker, 2);
    await chunker.clonePage(documentPage(chunker));
    await chunker.clonePage(documentPage(chunker));
    expect(chunker.clones).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("limitFootnotePages", () => {
  it("registers one module, once, which puts the stop on each chunker", () => {
    class Handler {
      constructor(_chunker: unknown, _polisher: unknown, _caller: unknown) {}
    }
    const registerHandlers = vi.fn();
    const paged = { Handler, registerHandlers } as never;
    limitFootnotePages(paged);
    limitFootnotePages(paged);
    expect(registerHandlers).toHaveBeenCalledTimes(1);

    const Module = registerHandlers.mock.calls[0][0] as new (...args: unknown[]) => unknown;
    const chunker = chunkerWhere(() => ({ keeps: "", overflows: false }));
    const original = chunker.clonePage;
    new Module(chunker, undefined, undefined);
    expect(chunker.clonePage).not.toBe(original);
  });
});
