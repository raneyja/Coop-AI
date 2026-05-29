export type ThemeMode = "light" | "dark" | "high-contrast";

export function clearInlineVscodeThemeVars(): void {
  const { style } = document.documentElement;
  const toRemove: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i);
    if (prop.startsWith("--vscode-")) {
      toRemove.push(prop);
    }
  }
  for (const prop of toRemove) {
    style.removeProperty(prop);
  }
}

export function detectThemeModeFromDom(): ThemeMode {
  const kind = document.body.getAttribute("data-vscode-theme-kind");
  if (kind === "vscode-light" || document.body.classList.contains("vscode-light")) {
    return "light";
  }
  if (
    kind === "vscode-high-contrast" ||
    kind === "vscode-high-contrast-light" ||
    document.body.classList.contains("vscode-high-contrast") ||
    document.body.classList.contains("vscode-high-contrast-light")
  ) {
    return "high-contrast";
  }
  return "dark";
}

export function applyThemeMode(mode: ThemeMode): void {
  clearInlineVscodeThemeVars();
  document.documentElement.dataset.theme = mode;
}

export function syncThemeFromVscodeDom(): ThemeMode {
  clearInlineVscodeThemeVars();
  const mode = detectThemeModeFromDom();
  document.documentElement.dataset.theme = mode;
  return mode;
}

export function startVscodeThemeSync(
  onChange?: (mode: ThemeMode) => void
): () => void {
  const apply = () => {
    const mode = syncThemeFromVscodeDom();
    onChange?.(mode);
  };

  apply();

  const observer = new MutationObserver(apply);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-vscode-theme-kind"]
  });

  return () => observer.disconnect();
}

export function sampleThemeMetrics(): Record<string, string> {
  const rootStyle = getComputedStyle(document.documentElement);
  return {
    dataTheme: document.documentElement.dataset.theme ?? "",
    bodyThemeKind: document.body.getAttribute("data-vscode-theme-kind") ?? "",
    bodyClasses: document.body.className,
    vscodeForeground: rootStyle.getPropertyValue("--vscode-foreground").trim(),
    vscodeForegroundInline: document.documentElement.style.getPropertyValue("--vscode-foreground").trim(),
    coopPanelCanvas: rootStyle.getPropertyValue("--coop-panel-canvas").trim(),
    coopPillText: rootStyle.getPropertyValue("--coop-pill-text").trim(),
    bodyColor: getComputedStyle(document.body).color,
    bodyBackground: getComputedStyle(document.body).backgroundColor
  };
}
