export type GraphSearchScope = "indexed" | "org";

export function parseGraphSearchScope(value: string | null): GraphSearchScope | undefined {
  if (value === "indexed" || value === "org") {
    return value;
  }
  return undefined;
}
