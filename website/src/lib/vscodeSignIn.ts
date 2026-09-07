/** Must match `COOP_EXTENSION_ID` / `COOP_SIGN_IN_PATH` in `src/extension/coopUriRoutes.ts`. */
export const COOP_VSCODE_EXTENSION_ID = "coop-ai.coop-ai";
export const COOP_VSCODE_SIGN_IN_PATH = "/sign-in";

/** Opens VS Code and asks Coop to show Account sign-in. Not an admin-portal URL. */
export function vscodeSignInHref(): string {
  return `vscode://${COOP_VSCODE_EXTENSION_ID}${COOP_VSCODE_SIGN_IN_PATH}`;
}
