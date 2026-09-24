// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TypstFileStat } from "./backend/types";
import { translations, type TranslationFn } from "./i18n/translations";
import type { TypstInput } from "./typstWorkerProtocol";

/** The folder beside the document, as the backend finds it, by path within it. */
const disk = vi.hoisted(() => ({
  files: new Map<string, { text: string; modified: number }>(),
  refused: new Map<string, "invalid" | "outside" | "unsupported" | "tooLarge">(),
  unavailable: false,
}));
/** Where the preview runs: the desktop app, a phone, the web. */
const host = vi.hoisted(() => ({ tauri: true, platform: "linux" as string | null }));
/** What the compiler was asked for, in order. */
const compiled = vi.hoisted(() => [] as TypstInput[]);

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => host.tauri }));
vi.mock("./hooks/usePlatform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hooks/usePlatform")>()),
  usePlatform: () => host.platform,
}));
vi.mock("./backend", () => ({
  backend: {
    typstFileStat: vi.fn(async (_handle: string, path: string): Promise<TypstFileStat> => {
      if (disk.unavailable) return { state: "unavailable" };
      const refused = disk.refused.get(path);
      if (refused) return { state: "refused", reason: refused };
      const file = disk.files.get(path);
      return file
        ? { state: "found", stat: { modifiedMs: file.modified, size: file.text.length } }
        : { state: "missing" };
    }),
    readTypstFile: vi.fn(async (_handle: string, path: string) => new TextEncoder().encode(disk.files.get(path)!.text)),
  },
}));
vi.mock("./typstEngine", () => ({
  getTypst: async () => ({
    $typst: {
      svg: async (input: TypstInput) => {
        compiled.push(input);
        return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
      },
      pdf: async () => undefined,
    },
  }),
}));

const { backend } = await import("./backend");
const { default: TypstPreview } = await import("./TypstPreview");
const { clearTypstFileCache } = await import("./typstFiles");

/** Real English translations, so the assertions read as the interface does. */
const t = ((key: string, ...args: unknown[]) => {
  const value = (translations.en as Record<string, unknown>)[key];
  return typeof value === "function" ? (value as (...a: unknown[]) => string)(...args) : String(value);
}) as TranslationFn;

const SAVED = { fileSource: { handle: "doc", locale: "en" }, docPath: "/docs/report.typ" };

function renderPreview(value: string, props: Partial<typeof SAVED> = {}) {
  return render(<TypstPreview value={value} t={t} onReverseSync={vi.fn()} {...props} />);
}

/** Let time pass, and whatever it set off finish: a look, a compile. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // What the look set off (another compile, 250 ms later) starts once React
  // has rendered its state, which it does when the act above ends.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

const noticeText = (container: HTMLElement) => container.querySelector(".typst-files-notice")?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  disk.files.clear();
  disk.refused.clear();
  disk.unavailable = false;
  host.tauri = true;
  host.platform = "linux";
  compiled.length = 0;
  clearTypstFileCache();
  vi.mocked(backend.typstFileStat).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("what the Typst preview says about the files beside the document", () => {
  it("asks for a save before an unsaved document can read the files it names", async () => {
    const { container } = renderPreview('#image("fig.png")');
    await wait(0);
    expect(noticeText(container)).toBe("Save the document so Typst can read the files beside it.");
  });

  it("says only the desktop app can, on a phone and on the web, where saving would not help", async () => {
    host.platform = "android";
    const phone = renderPreview('#image("fig.png")');
    await wait(0);
    expect(noticeText(phone.container)).toBe("Only the desktop app can give Typst the files beside a document.");
    cleanup();

    host.platform = "web";
    host.tauri = false;
    const web = renderPreview('#image("fig.png")');
    await wait(0);
    expect(noticeText(web.container)).toBe("Only the desktop app can give Typst the files beside a document.");
  });

  it("says only the desktop app can, for a saved document the backend has no folder for", async () => {
    disk.unavailable = true;
    const { container } = renderPreview('#image("fig.png")', SAVED);
    await wait(0);
    expect(noticeText(container)).toBe("Only the desktop app can give Typst the files beside a document.");
  });

  it("says nothing of files to a document that names none", async () => {
    const { container } = renderPreview("= Hello");
    await wait(0);
    expect(compiled).toHaveLength(1);
    expect(noticeText(container)).toBeNull();
  });

  it("names each file left out and why, but not a missing one, which Typst names itself", async () => {
    disk.refused.set("../up.typ", "invalid");
    disk.refused.set("big.png", "tooLarge");
    disk.refused.set("tool.wasm", "unsupported");
    const source = '#include "../up.typ"\n#image("big.png")\n#plugin("tool.wasm")\n#image("gone.png")';
    const { container } = renderPreview(source, SAVED);
    await wait(0);
    expect(container.querySelector(".typst-files-notice p")?.textContent).toBe("Typst was not given these files:");
    expect([...container.querySelectorAll(".typst-files-notice li")].map((item) => item.textContent)).toEqual([
      "../up.typ: only files in the document's folder, and not hidden ones, can be read",
      "big.png: larger than 32 MiB",
      "tool.wasm: not a kind of file Typst is given",
    ]);
  });

  it("names the file past the deepest nesting, with the limits", async () => {
    for (let n = 1; n <= 9; n++) disk.files.set(`n${n}.typ`, { text: `#include "n${n + 1}.typ"`, modified: 1 });
    const { container } = renderPreview('#include "n1.typ"', SAVED);
    await wait(0);
    expect([...container.querySelectorAll(".typst-files-notice li")].map((item) => item.textContent)).toEqual([
      "n9.typ: past the most one document may read: 256 files, 64 MiB, 8 levels of include",
    ]);
  });
});

describe("the files the Typst preview compiles with", () => {
  it("are the folder's, with the document at its own place there", async () => {
    disk.files.set("fig.png", { text: "PNG", modified: 1 });
    renderPreview('#image("fig.png")', { ...SAVED, docPath: "C:\\docs\\report.typ" });
    await wait(0);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].folder?.id).toBe("doc");
    expect(compiled[0].folder?.mainPath).toBe("/report.typ");
    expect([...compiled[0].folder!.files.keys()]).toEqual(["fig.png"]);
  });

  it("are looked at again every few seconds, and compiled again only when one moved", async () => {
    disk.files.set("fig.png", { text: "one", modified: 1 });
    renderPreview('#image("fig.png")', SAVED);
    await wait(0);
    expect(compiled).toHaveLength(1);
    await wait(3000);
    expect(compiled).toHaveLength(1);
    disk.files.set("fig.png", { text: "two", modified: 2 });
    await wait(3000);
    expect(compiled).toHaveLength(2);
    expect(new TextDecoder().decode(compiled[1].folder!.files.get("fig.png")!.bytes)).toBe("two");
  });

  it("are looked at again on coming back to the window", async () => {
    disk.files.set("fig.png", { text: "one", modified: 1 });
    renderPreview('#image("fig.png")', SAVED);
    await wait(0);
    disk.files.set("fig.png", { text: "two", modified: 2 });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    // Well before the next look on the clock.
    await wait(0);
    expect(compiled).toHaveLength(2);
  });

  it("are not looked at while the window is hidden", async () => {
    disk.files.set("fig.png", { text: "one", modified: 1 });
    renderPreview('#image("fig.png")', SAVED);
    await wait(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const looked = vi.mocked(backend.typstFileStat).mock.calls.length;
    await wait(6000);
    expect(vi.mocked(backend.typstFileStat).mock.calls.length).toBe(looked);
  });

  it("are no longer looked at once the preview is gone", async () => {
    disk.files.set("fig.png", { text: "one", modified: 1 });
    const view = renderPreview('#image("fig.png")', SAVED);
    await wait(0);
    view.unmount();
    const looked = vi.mocked(backend.typstFileStat).mock.calls.length;
    await wait(6000);
    expect(vi.mocked(backend.typstFileStat).mock.calls.length).toBe(looked);
  });
});
