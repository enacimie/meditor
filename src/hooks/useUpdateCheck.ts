import { useCallback, useRef, useState } from "react";
import type { TranslationFn } from "../i18n/translations";
import type { NoticeAPI } from "./useNotice";

/** A newer version that is ready to install, and the call that installs it. */
export type UpdateOffer = {
  /** The version on offer. */
  version: string;
  /** The version running now, so the dialog can show both. */
  current: string;
  /** Download, install, and restart into the new version. */
  install: () => Promise<void>;
};

export type UpdateCheckAPI = {
  /** Set once a newer version has been found; drives the dialog. */
  offer: UpdateOffer | null;
  /** True while a check or an install is in flight. */
  busy: boolean;
  /** Ask GitHub whether there is a newer version. */
  checkForUpdates: () => Promise<void>;
  /** Close the offer without installing. */
  dismiss: () => void;
};

/** Loaded on demand: see the note on `useUpdateCheck`. */
const loadUpdaterModule = () => import("@tauri-apps/plugin-updater");
const loadProcessModule = () => import("@tauri-apps/plugin-process");
const loadVersion = () => import("@tauri-apps/api/app").then((m) => m.getVersion());

type Loaders = {
  loadUpdater?: () => Promise<{ check: typeof import("@tauri-apps/plugin-updater").check }>;
  loadProcess?: () => Promise<{ relaunch: typeof import("@tauri-apps/plugin-process").relaunch }>;
  getVersion?: () => Promise<string>;
};

/**
 * Look for a newer meditor, and install it if the user says so.
 *
 * Only ever runs because someone asked: there is no check on startup. meditor
 * is a local-first editor that makes no network requests of its own, and
 * having it call home every time it opens would trade that away for something
 * a menu entry does just as well.
 *
 * The Tauri modules are imported on demand rather than at the top of the file.
 * They do not exist in a browser, where this hook still gets mounted, and the
 * build has a budget on the initial chunk that there is no reason to spend on
 * a code path most sessions never take.
 *
 * Every outcome is reported, including "you are already up to date" and every
 * failure. That is the whole difference a check-on-startup would have made:
 * silence is the right answer to a question nobody asked, and the wrong one to
 * a button somebody just pressed.
 *
 * @param t - translation function.
 * @param notice - the app's notice banner, for progress and failures.
 * @param loaders - injectable module loaders; the tests pass fakes.
 */
export function useUpdateCheck(
  t: TranslationFn,
  notice: Pick<NoticeAPI, "showNotice" | "dismissNotice">,
  loaders: Loaders = {},
): UpdateCheckAPI {
  const {
    loadUpdater = loadUpdaterModule,
    loadProcess = loadProcessModule,
    getVersion = loadVersion,
  } = loaders;
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * The guard reads a ref, not the state beside it. Two clicks in the same
   * tick share one closure, so a state flag would still be false on the second
   * and both checks would run — which is the case the guard exists for.
   *
   * Both paths that raise it lower it again in a `finally`. Getting that wrong
   * does not fail loudly: the menu entry works once and then goes quiet for
   * the rest of the session, which is how it shipped in the first draft.
   */
  const busyRef = useRef(false);

  const { showNotice, dismissNotice } = notice;

  const dismiss = useCallback(() => setOffer(null), []);

  const checkForUpdates = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // Persistent: a check crosses the network and can take a moment, and a
    // banner that vanishes mid-wait reads as though nothing happened.
    showNotice(t("update.checking"), "info", 0);
    try {
      const { check } = await loadUpdater();
      const update = await check();
      if (!update) {
        showNotice(t("update.upToDate", await getVersion()), "info");
        return;
      }
      dismissNotice();
      setOffer({
        version: update.version,
        current: update.currentVersion,
        install: async () => {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          showNotice(t("update.downloading"), "info", 0);
          try {
            await update.downloadAndInstall();
            const { relaunch } = await loadProcess();
            await relaunch();
          } catch (error) {
            console.error("The update could not be installed", error);
            showNotice(t("update.failed"), "error");
          } finally {
            busyRef.current = false;
            setBusy(false);
            setOffer(null);
          }
        },
      });
    } catch (error) {
      // Offline, GitHub down, or the updater not configured at all — which is
      // how it ships until the release signing keys exist. All the same to
      // whoever pressed the button: it did not work.
      console.error("The update check failed", error);
      showNotice(t("update.failed"), "error");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [t, showNotice, dismissNotice, loadUpdater, loadProcess, getVersion]);

  return { offer, busy, checkForUpdates, dismiss };
}
