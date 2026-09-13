import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export const EvidenceConnectionExpandContext = createContext<(() => void) | undefined>(undefined);

export function useEvidenceConnectionExpand(): (() => void) | undefined {
  return useContext(EvidenceConnectionExpandContext);
}

export type EvidenceCardExpandApi = {
  expanded: boolean;
  expand: () => void;
  toggle: () => void;
};

export const EvidenceCardExpandContext = createContext<EvidenceCardExpandApi | undefined>(undefined);

/** Owns collapsed/expanded state for a Sources card. Default is collapsed. */
export function EvidenceCardExpandProvider({
  children
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => {
    setExpanded(true);
  }, []);
  const toggle = useCallback(() => {
    setExpanded((value) => !value);
  }, []);
  const value = useMemo(
    () => ({ expanded, expand, toggle }),
    [expanded, expand, toggle]
  );
  return React.createElement(EvidenceCardExpandContext.Provider, { value }, children);
}

export function useEvidenceCardExpand(): EvidenceCardExpandApi | undefined {
  return useContext(EvidenceCardExpandContext);
}

export const SourcesFoldExpandContext = createContext<(() => void) | undefined>(undefined);

export function useSourcesFoldExpand(): (() => void) | undefined {
  return useContext(SourcesFoldExpandContext);
}
