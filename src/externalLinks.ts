import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Whether a link is safe to hand to the system.
 *
 * The guard is against schemes that execute rather than navigate —
 * `javascript:` above all — so it works by allowing three rather than by
 * denying the rest.
 *
 * `mailto:` is on the list because the links in a rendered document are the
 * user's own prose, and an address written in Markdown should open the mail
 * client like it does everywhere else. The About dialog only ever passes its
 * own constants, so it neither needs nor is harmed by the wider list.
 */
export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    // Not a URL at all — a relative href, or something malformed.
    return false;
  }
}

/**
 * Open a link outside the app: the system browser or mail client.
 *
 * Blocking is reported rather than silent. A link that does nothing when
 * clicked is otherwise indistinguishable from a broken one, and this is the
 * only place that would know why.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    console.warn("Blocked external link:", url);
    return;
  }
  if (isTauri()) {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Could not open link:", error);
    }
  } else {
    // `noopener` matters: without it the opened page gets a handle back to
    // this one through `window.opener`.
    window.open(url, "_blank", "noopener");
  }
}
