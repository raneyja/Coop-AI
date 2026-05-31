import { useEffect } from "react";
import { COOP_PANEL_MIN_WIDTH } from "../../ui/panelMinWidth";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

declare global {
  interface Window {
    __COOP_ENFORCE_MIN_WIDTH__?: boolean;
  }
}

const ENFORCE_DEBOUNCE_MS = 80;

/**
 * When running in the activity-bar sidebar, ask the extension host to widen the
 * panel if the user drags it below our design minimum.
 */
export function PanelWidthEnforcer({ vscode }: { vscode: VsCodeApi }): null {
  useEffect(() => {
    if (!window.__COOP_ENFORCE_MIN_WIDTH__) {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const root = document.documentElement;

    const reportIfTooNarrow = (width: number) => {
      if (width >= COOP_PANEL_MIN_WIDTH) {
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        vscode.postMessage({
          type: "ui:ensure-min-width",
          payload: { width, minWidth: COOP_PANEL_MIN_WIDTH }
        });
      }, ENFORCE_DEBOUNCE_MS);
    };

    const observer = new ResizeObserver(([entry]) => {
      reportIfTooNarrow(entry.contentRect.width);
    });

    observer.observe(root);
    reportIfTooNarrow(root.clientWidth);

    return () => {
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [vscode]);

  return null;
}
