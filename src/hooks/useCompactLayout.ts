import { useEffect, useState } from "react";

/**
 * Whether the window is 760 px wide or less, where the panes stack instead of
 * sitting side by side.
 */
export function useCompactLayout() {
  const [compactLayout, setCompactLayout] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return compactLayout;
}
