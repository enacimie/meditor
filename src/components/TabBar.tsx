import { memo, useEffect, useRef } from "react";
import type { TranslationFn } from "../i18n/translations";
import type { Doc } from "../types";
import "./TabBar.css";

type Props = {
  t: TranslationFn;
  docs: Doc[];
  activeId: string;
  busyOperation: string | null;
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
    <div ref={tabbarRef} className="tabbar" role="tablist" aria-label={t("tab.documentsOpen")}>
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
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const next = docs[(index + 1) % docs.length];
                onSelectTab(next.id);
                (e.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[
                  (index + 1) % docs.length
                ])?.focus();
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
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
            {d.dirty && <span className="tab-dirty" aria-label={t("tab.unsaved")}>•</span>}
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
