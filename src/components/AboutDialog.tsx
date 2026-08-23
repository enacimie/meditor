import { memo, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TranslationFn } from "../i18n/translations";
import "./AboutDialog.css";

type Props = {
  t: TranslationFn;
  onClose: () => void;
};

// Duration of the exit transition in AboutDialog.css — keep in sync.
const EXIT_MS = 140;

const REPO_URL = "https://github.com/enacimie/meditor";
const LICENSE_NAME = "GNU Affero General Public License v3.0";
const FALLBACK_VERSION = "0.1.5";

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function openExternal(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) return;
  if (isTauri()) {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Could not open link", error);
    }
  } else {
    window.open(url, "_blank", "noopener");
  }
}

const AboutDialog = memo(function AboutDialog({ t, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  // Read the app version from Tauri; fall back to a static value in plain web
  // contexts (dev server, tests) where the IPC command is unavailable.
  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) {
      setVersion(FALLBACK_VERSION);
      return;
    }
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(FALLBACK_VERSION);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the close button on mount and restore focus to the element that
  // opened the dialog when it closes (a11y).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Cancel any pending exit timer if the dialog unmounts early.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Play the CSS exit transition before resolving, matching the other dialogs.
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    closeTimerRef.current = window.setTimeout(onClose, reduced ? 0 : EXIT_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
  };

  return (
    <div
      className={"about-overlay" + (closing ? " closing" : "")}
      role="dialog"
      aria-label={t("about.title")}
      aria-modal="true"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="about-panel" ref={panelRef}>
        <button
          ref={closeBtnRef}
          type="button"
          className="about-close"
          onClick={requestClose}
          aria-label={t("about.close")}
        >
          ✕
        </button>
        <div className="about-brand">{t("app.brand")}</div>
        {version && (
          <div className="about-version">{t("about.version", version)}</div>
        )}
        <p className="about-tagline">{t("about.tagline")}</p>
        <div className="about-meta">
          <span className="about-meta-label">{t("about.license")}</span>
          <span className="about-meta-value">{LICENSE_NAME}</span>
        </div>
        <a
          className="about-link"
          href={REPO_URL}
          onClick={(e) => {
            e.preventDefault();
            void openExternal(REPO_URL);
          }}
        >
          {t("about.source")}
        </a>
      </div>
    </div>
  );
});

export default AboutDialog;
