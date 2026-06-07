export type ThemeMode = "light" | "dark" | "high-contrast";

/** VS Code injects theme tokens on `body`; our coop tokens are defined on `html`. */
const VSCODE_THEME_VARS = [
  "--vscode-foreground",
  "--vscode-editor-foreground",
  "--vscode-sideBar-foreground",
  "--vscode-descriptionForeground",
  "--vscode-editor-background",
  "--vscode-sideBar-background",
  "--vscode-input-background",
  "--vscode-input-foreground",
  "--vscode-input-border",
  "--vscode-input-placeholderForeground",
  "--vscode-focusBorder",
  "--vscode-widget-border",
  "--vscode-panel-border",
  "--vscode-contrastBorder",
  "--vscode-button-border"
] as const;

export function bridgeVscodeThemeVarsToRoot(): void {
  const bodyStyle = getComputedStyle(document.body);
  const root = document.documentElement.style;
  for (const name of VSCODE_THEME_VARS) {
    const value = bodyStyle.getPropertyValue(name).trim();
    if (value) {
      root.setProperty(name, value);
    } else {
      root.removeProperty(name);
    }
  }
}

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
  if (mode !== "light") {
    bridgeVscodeThemeVarsToRoot();
  }
}

export function syncThemeFromVscodeDom(): ThemeMode {
  clearInlineVscodeThemeVars();
  const mode = detectThemeModeFromDom();
  document.documentElement.dataset.theme = mode;
  if (mode !== "light") {
    bridgeVscodeThemeVarsToRoot();
  }
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
