import type { IdentityDirectory } from "./types";
import { EMPTY_IDENTITY_DIRECTORY } from "./types";

let provider: (() => Promise<IdentityDirectory>) | undefined;

export function registerIdentityDirectoryProvider(
  next: () => Promise<IdentityDirectory>
): void {
  provider = next;
}

export async function getIdentityDirectory(): Promise<IdentityDirectory> {
  if (!provider) {
    return { ...EMPTY_IDENTITY_DIRECTORY };
  }
  return provider();
}
