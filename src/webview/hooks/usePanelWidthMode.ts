import { useEffect } from "react";
import { COOP_PANEL_MIN_WIDTH } from "../../ui/panelMinWidth";

/** Track webview width without CSS container-type (breaks VS Code sidebar sizing). */
export function usePanelWidthMode(): void {
  useEffect(() => {
    const root = document.documentElement;

    const apply = (width: number) => {
      if (width < COOP_PANEL_MIN_WIDTH) {
        root.dataset.coopNarrow = "true";
      } else {
        delete root.dataset.coopNarrow;
      }
    };

    const observer = new ResizeObserver(([entry]) => {
      apply(entry.contentRect.width);
    });

    observer.observe(root);
    apply(root.clientWidth);

    return () => {
      observer.disconnect();
      delete root.dataset.coopNarrow;
    };
  }, []);
}
