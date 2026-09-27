import { memo, useEffect, useRef } from "react";
import type { TranslationFn } from "../i18n/translations";
import type { Doc } from "../types";
import "./TabBar.css";

type Props = {
  t: TranslationFn;
  docs: Doc[];
  activeId: string;
  busyOperation: string | null;
  /**
   * Whether the interface reads right-to-left, where the arrow that means
   * "the next tab" points the other way. The topbar's layout switch already
   * mirrors for this; the tabs did not.
   */
  rtl?: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string) => void;
  onNewTab: () => void;
};

const TabBar = memo(function TabBar({
  t,
  docs,
  activeId,
  busyOperation,
  rtl = false,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onNewTab,
}: Props) {
  const busy = busyOperation !== null;
  const tabbarRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the active tab into view
  useEffect(() => {
    const el = tabbarRef.current?.querySelector<HTMLElement>(".tab.active");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div ref={tabbarRef} className="tabbar">
      {/*
        The tablist wraps the tabs alone. The "+" button used to sit inside
        it, and a tablist may own nothing but tabs: assistive tech walking
        the list met a control that was not one, and could skip it.
        display:contents keeps the flex layout exactly as it was.
      */}
      <div className="tabbar-list" role="tablist" aria-label={t("tab.documentsOpen")}>
      {docs.map((d) => (
        <div
          key={d.id}
          className={"tab" + (d.id === activeId ? " active" : "")}
          role="presentation"
        >
          <button
            type="button"
            className="tab-main"
            id={`tab-${d.id}`}
            disabled={busy}
            role="tab"
            tabIndex={d.id === activeId ? 0 : -1}
            aria-selected={d.id === activeId}
            aria-controls="workspace-panels"
            onKeyDown={(e) => {
              const index = docs.findIndex((item) => item.id === d.id);
              // Mirrored in RTL, where the next tab is to the left.
              const nextKey = rtl ? "ArrowLeft" : "ArrowRight";
              const prevKey = rtl ? "ArrowRight" : "ArrowLeft";
              if (e.key === nextKey || e.key === "ArrowDown") {
                e.preventDefault();
                const next = docs[(index + 1) % docs.length];
                onSelectTab(next.id);
                (e.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[
                  (index + 1) % docs.length
                ])?.focus();
              } else if (e.key === prevKey || e.key === "ArrowUp") {
                e.preventDefault();
                const previous = docs[(index - 1 + docs.length) % docs.length];
                onSelectTab(previous.id);
                (e.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[
                  (index - 1 + docs.length) % docs.length
                ])?.focus();
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectTab(d.id);
              }
            }}
            onClick={() => onSelectTab(d.id)}
            onDoubleClick={() => onRenameTab(d.id)}
            aria-label={`${d.name}${d.dirty ? ", " + t("tab.unsaved") : ""}`}
            title={d.path ?? d.name}
          >
            {/* The button's own aria-label already says "unsaved"; a second
                name on the dot would announce it twice. */}
            {d.dirty && <span className="tab-dirty" aria-hidden="true">•</span>}
            <span className="tab-name">{d.name}</span>
          </button>
          {docs.length > 1 && (
            <button
              type="button"
              className="tab-close"
              aria-label={t("tab.close", d.name)}
              onClick={() => onCloseTab(d.id)}
              disabled={busy}
            >
              ×
            </button>
          )}
        </div>
      ))}
      </div>
      <button
        type="button"
        className="tab-add"
        aria-label={t("tab.newAria")}
        onClick={onNewTab}
        disabled={busy}
      >
        +
      </button>
    </div>
  );
});

export default TabBar;
