import { createContext, useContext } from "react";

export const EvidenceConnectionExpandContext = createContext<(() => void) | undefined>(undefined);

export function useEvidenceConnectionExpand(): (() => void) | undefined {
  return useContext(EvidenceConnectionExpandContext);
}
