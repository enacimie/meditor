// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUpdateCheck } from "./useUpdateCheck";
import type { TranslationFn } from "../i18n/translations";
import type { NoticeAPI } from "./useNotice";

/** Echoes the key and its arguments so assertions can read intent, not prose. */
const t = ((key: string, ...args: unknown[]) =>
  [key, ...args].join("|")) as unknown as TranslationFn;

describe("useUpdateCheck", () => {
  let showNotice: ReturnType<typeof vi.fn<NoticeAPI["showNotice"]>>;
  let dismissNotice: ReturnType<typeof vi.fn<() => void>>;
  let relaunch: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    showNotice = vi.fn<NoticeAPI["showNotice"]>();
    dismissNotice = vi.fn<() => void>();
    relaunch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  /** Mount the hook with the Tauri modules replaced by whatever the test needs. */
  function mount(check: () => Promise<unknown>) {
    return renderHook(() =>
      useUpdateCheck(
        t,
        { showNotice, dismissNotice },
        {
          loadUpdater: async () => ({ check }) as never,
          loadProcess: async () => ({ relaunch }) as never,
          getVersion: async () => "0.1.7",
        },
      ),
    );
  }

  /** An update the plugin would hand back, with its install call stubbed. */
  const anUpdate = (downloadAndInstall = vi.fn().mockResolvedValue(undefined)) => ({
    version: "0.1.8",
    currentVersion: "0.1.7",
    downloadAndInstall,
  });

  it("says so when there is nothing to install", async () => {
    const { result } = mount(async () => null);

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.offer).toBeNull();
    // Reporting "you are up to date" is the point of an on-demand check:
    // silence would look like the button did nothing.
    expect(showNotice).toHaveBeenLastCalledWith("update.upToDate|0.1.7", "info");
  });

  it("offers the new version with both numbers", async () => {
    const { result } = mount(async () => anUpdate());

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.offer).toEqual(
      expect.objectContaining({ version: "0.1.8", current: "0.1.7" }),
    );
    // The "checking…" banner is persistent, so it has to be taken down by
    // hand once the dialog takes over.
    expect(dismissNotice).toHaveBeenCalled();
  });

  it("installs and then restarts", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const { result } = mount(async () => anUpdate(downloadAndInstall));

    await act(async () => {
      await result.current.checkForUpdates();
    });
    await act(async () => {
      await result.current.offer!.install();
    });

    expect(downloadAndInstall).toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalled();
    expect(result.current.offer).toBeNull();
  });

  it("reports a failed check instead of failing quietly", async () => {
    // Offline, GitHub down, or the updater not configured — which is how it
    // ships until the signing keys exist. The user pressed a button and is
    // owed an answer either way.
    const { result } = mount(async () => {
      throw new Error("no endpoints configured");
    });

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.offer).toBeNull();
    expect(showNotice).toHaveBeenLastCalledWith("update.failed", "error");
  });

  it("reports an install that fails and puts the dialog away", async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error("bad signature"));
    const { result } = mount(async () => anUpdate(downloadAndInstall));

    await act(async () => {
      await result.current.checkForUpdates();
    });
    await act(async () => {
      await result.current.offer!.install();
    });

    expect(relaunch).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenLastCalledWith("update.failed", "error");
    expect(result.current.offer).toBeNull();
  });

  it("installs nothing when the offer is declined", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const { result } = mount(async () => anUpdate(downloadAndInstall));

    await act(async () => {
      await result.current.checkForUpdates();
    });
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.offer).toBeNull();
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does not check twice over one click", async () => {
    // Both calls share a closure, so a state flag would still read false on
    // the second. The guard is a ref for exactly this.
    const check = vi.fn().mockResolvedValue(null);
    const { result } = mount(check);

    await act(async () => {
      await Promise.all([
        result.current.checkForUpdates(),
        result.current.checkForUpdates(),
      ]);
    });

    expect(check).toHaveBeenCalledTimes(1);
  });
});
