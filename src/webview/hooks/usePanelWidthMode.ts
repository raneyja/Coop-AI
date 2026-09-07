import { useEffect } from "react";
import { COOP_PANEL_MIN_WIDTH } from "../../ui/panelMinWidth";

/** Track webview width — use window.innerWidth (iframe viewport), not documentElement shrink-wrap. */
export function usePanelWidthMode(): void {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const width = window.innerWidth;
      if (width < COOP_PANEL_MIN_WIDTH) {
        root.dataset.coopNarrow = "true";
      } else {
        delete root.dataset.coopNarrow;
      }
    };

    window.addEventListener("resize", apply);
    apply();

    return () => {
      window.removeEventListener("resize", apply);
      delete root.dataset.coopNarrow;
    };
  }, []);
}
