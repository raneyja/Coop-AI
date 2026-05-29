import * as vscode from "vscode";
import type { ThemeMode } from "./types";

export function themeModeFromColorTheme(kind: vscode.ColorThemeKind): ThemeMode {
  if (kind === vscode.ColorThemeKind.Light) {
    return "light";
  }
  if (
    kind === vscode.ColorThemeKind.HighContrast ||
    kind === vscode.ColorThemeKind.HighContrastLight
  ) {
    return "high-contrast";
  }
  return "dark";
}

export function activeThemeMode(): ThemeMode {
  return themeModeFromColorTheme(vscode.window.activeColorTheme.kind);
}
