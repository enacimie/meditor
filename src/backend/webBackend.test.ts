// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  webBackend,
  type FsFileHandleLike,
} from "./webBackend";

function fakeHandle(file: {
  name: string;
  content: string;
  lastModified?: number;
  size?: number;
}): { handle: FsFileHandleLike; written: string[] } {
  const written: string[] = [];
  const handle: FsFileHandleLike = {
    kind: "file",
    name: file.name,
    getFile: async () => ({
      name: file.name,
      text: async () => file.content,
      lastModified: file.lastModified ?? 1000,
      size: file.size ?? file.content.length,
    }),
    createWritable: async () => ({
      write: async (data) => {
        written.push(String(data));
      },
      close: async () => undefined,
    }),
  };
  return { handle, written };
}

beforeEach(() => {
  localStorage.clear();
  window.URL.createObjectURL = vi.fn(() => "blob:mock");
  window.URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  delete (window as Partial<PickerWindow>).showOpenFilePicker;
  delete (window as Partial<PickerWindow>).showSaveFilePicker;
  vi.restoreAllMocks();
});

type PickerWindow = Window & {
  showOpenFilePicker?(options?: unknown): Promise<FsFileHandleLike[]>;
  showSaveFilePicker?(options?: unknown): Promise<FsFileHandleLike>;
};

describe("webBackend sessions", () => {
  it("round-trips a session and strips handles", async () => {
    await webBackend.saveSession(
      {
        docs: [
          {
            id: "d1",
            name: "a.md",
            path: "a.md",
            content: "A",
            dirty: true,
            handle: "web-9",
            kind: "markdown",
          },
        ],
        activeId: "d1",
        split: 50,
      },
      "en",
    );
    const restored = await webBackend.loadSession("en");
    expect(restored).not.toBeNull();
    expect(restored!.docs[0]).toMatchObject({ id: "d1", content: "A", dirty: true });
    expect(restored!.docs[0].handle).toBeUndefined();
    expect(restored!.activeId).toBe("d1");
    expect(restored!.split).toBe(50);
  });

  it("falls back to the first document and clamps the split", async () => {
    localStorage.setItem(
      "meditor.web.session.v3",
      JSON.stringify({
        version: 3,
        activeId: "missing",
        split: 99,
        docs: [{ id: "only", name: "b.md", path: null, content: "", dirty: false, kind: "markdown" }],
      }),
    );
    const restored = await webBackend.loadSession("en");
    expect(restored!.activeId).toBe("only");
    expect(restored!.split).toBe(80);
  });

  it("rejects corrupt, foreign-version and empty payloads", async () => {
    localStorage.setItem("meditor.web.session.v3", "{not json");
    expect(await webBackend.loadSession("en")).toBeNull();
    localStorage.setItem(
      "meditor.web.session.v3",
      JSON.stringify({ version: 2, docs: [{ id: "x" }], activeId: "x", split: 50 }),
    );
    expect(await webBackend.loadSession("en")).toBeNull();
    localStorage.setItem("meditor.web.session.v3", JSON.stringify({ version: 3, docs: [], activeId: "", split: 50 }));
    expect(await webBackend.loadSession("en")).toBeNull();
  });
});

describe("webBackend files without the File System Access API", () => {
  it("save-as downloads and returns an unhandled document so saves stay explicit", async () => {
    const saved = await webBackend.saveAs("# hi", "notes.md", "en");
    expect(saved).toMatchObject({
      name: "notes.md",
      path: "notes.md",
      content: "# hi",
      handle: null,
      kind: "markdown",
    });
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    // Without a live handle, saving again must not silently re-download.
    await expect(webBackend.saveDocument(saved!.handle ?? "", "x", "en")).rejects.toThrow();
  });

  it("stats and reads of unknown handles degrade like unwatchable files", async () => {
    expect(await webBackend.documentStat("nope", "en")).toBeNull();
    expect(await webBackend.readDocument("nope", "en")).toBe("");
  });

  it("validates PDF output before downloading", async () => {
    await expect(webBackend.writePdfBytes(new TextEncoder().encode("nope"), "x.pdf", "en")).rejects.toThrow(
      /valid PDF/,
    );
    const ok = new TextEncoder().encode("%PDF-1.7 rest");
    await webBackend.writePdfBytes(ok, "doc.pdf", "en");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });
});

describe("webBackend files with the File System Access API", () => {
  it("keeps a live handle: save writes in place, watcher can stat and read", async () => {
    const { handle, written } = fakeHandle({ name: "live.md", content: "", size: 8 });
    // fsaAvailable() probes the open picker; a browser with FSA has both.
    (window as PickerWindow).showOpenFilePicker = vi.fn();
    (window as PickerWindow).showSaveFilePicker = vi.fn(async () => handle);

    const saved = await webBackend.saveAs("# live", "live.md", "en");
    expect(written).toEqual(["# live"]);
    expect(saved!.handle).toMatch(/^web-/);

    await webBackend.saveDocument(saved!.handle!, "# edited", "en");
    expect(written).toEqual(["# live", "# edited"]);

    const stat = await webBackend.documentStat(saved!.handle!, "en");
    expect(stat).toEqual({ modifiedMs: 1000, size: 8 });

    expect(await webBackend.readDocument(saved!.handle!, "en")).toBe("");

    // The picker's cancel is not an error.
    (window as PickerWindow).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    expect(await webBackend.saveAs("y", "y.md", "en")).toBeNull();
  });

  it("open returns [] when the picker is cancelled or unavailable", async () => {
    (window as PickerWindow).showOpenFilePicker = vi.fn(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    expect(await webBackend.openFiles("en")).toEqual([]);

    delete (window as Partial<PickerWindow>).showOpenFilePicker;
    // Input fallback with no dialog possible: focus-with-timeout resolves empty.
    const pending = webBackend.openFiles("en");
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 400));
    await expect(pending).resolves.toEqual([]);
  }, 10000);
});
