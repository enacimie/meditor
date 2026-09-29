import type { SplitDividerAPI } from "../hooks/useSplitDivider";
import type { TranslationFn } from "../i18n/translations";

type Props = Pick<
  SplitDividerAPI,
  "split" | "setSplit" | "splitRatioRef" | "onDividerDown" | "onDividerMove" | "onDividerUp"
> & {
  t: TranslationFn;
  compactLayout: boolean;
};

/**
 * The bar between the editor and the preview. It is dragged with the pointer,
 * or moved in steps with the arrow keys once it has the focus.
 */
export default function SplitDivider({
  t,
  compactLayout,
  split,
  setSplit,
  splitRatioRef,
  onDividerDown,
  onDividerMove,
  onDividerUp,
}: Props) {
  return (
    <div
      className="split-divider"
      role="separator"
      aria-orientation={compactLayout ? "horizontal" : "vertical"}
      aria-label={t("pane.resize")}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(split)}
      tabIndex={0}
      onKeyDown={(e) => {
        const decrease = compactLayout ? "ArrowUp" : "ArrowLeft";
        const increase = compactLayout ? "ArrowDown" : "ArrowRight";
        if (e.key === decrease || e.key === increase) {
          e.preventDefault();
          const delta = e.key === decrease ? -5 : 5;
          setSplit((value) => {
            const next = Math.max(20, Math.min(80, value + delta));
            splitRatioRef.current = next;
            return next;
          });
        }
      }}
      onPointerDown={onDividerDown}
      onPointerMove={onDividerMove}
      onPointerUp={onDividerUp}
      onLostPointerCapture={onDividerUp}
    />
  );
}
