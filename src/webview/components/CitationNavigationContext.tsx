import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { matchSourceCitationLabel } from "../../prompts/sourceCitationRegistry";

type AnchorEntry = {
  element: HTMLElement;
  expand?: () => void;
};

type CitationNavigationContextValue = {
  registerEvidenceAnchor: (id: string, element: HTMLElement | null, expand?: () => void) => void;
  registerCitationAnchor: (id: string, element: HTMLElement | null) => void;
  scrollToEvidence: (id: string) => void;
  scrollToCitation: (id: string) => void;
  resolveCitationId: (label: string, knownLabels: string[]) => string | undefined;
};

const CitationNavigationContext = createContext<CitationNavigationContextValue | undefined>(undefined);

export function CitationNavigationProvider({
  children
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const evidenceAnchors = useRef(new Map<string, AnchorEntry>());
  const citationAnchors = useRef(new Map<string, HTMLElement>());

  const registerEvidenceAnchor = useCallback(
    (id: string, element: HTMLElement | null, expand?: () => void) => {
      if (!element) {
        evidenceAnchors.current.delete(id);
        return;
      }
      evidenceAnchors.current.set(id, { element, expand });
    },
    []
  );

  const registerCitationAnchor = useCallback((id: string, element: HTMLElement | null) => {
    if (!element) {
      citationAnchors.current.delete(id);
      return;
    }
    citationAnchors.current.set(id, element);
  }, []);

  const highlight = useCallback((element: HTMLElement) => {
    element.classList.add("coop-result-highlight");
    window.setTimeout(() => element.classList.remove("coop-result-highlight"), 2000);
  }, []);

  const scrollToEvidence = useCallback(
    (id: string) => {
      const entry = evidenceAnchors.current.get(id);
      if (!entry) {
        return;
      }
      entry.expand?.();
      entry.element.scrollIntoView({ behavior: "smooth", block: "center" });
      highlight(entry.element);
    },
    [highlight]
  );

  const scrollToCitation = useCallback(
    (id: string) => {
      const element = citationAnchors.current.get(id);
      if (!element) {
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      highlight(element);
    },
    [highlight]
  );

  const resolveCitationId = useCallback((label: string, knownLabels: string[]) => {
    const matched = matchSourceCitationLabel(label, knownLabels);
    if (!matched) {
      return undefined;
    }
    for (const [id] of evidenceAnchors.current) {
      if (id.endsWith(`--${matched.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)) {
        return id;
      }
    }
    return undefined;
  }, []);

  const value = useMemo(
    () => ({
      registerEvidenceAnchor,
      registerCitationAnchor,
      scrollToEvidence,
      scrollToCitation,
      resolveCitationId
    }),
    [registerCitationAnchor, registerEvidenceAnchor, resolveCitationId, scrollToCitation, scrollToEvidence]
  );

  return <CitationNavigationContext.Provider value={value}>{children}</CitationNavigationContext.Provider>;
}

export function useCitationNavigation(): CitationNavigationContextValue {
  const context = useContext(CitationNavigationContext);
  if (!context) {
    return {
      registerEvidenceAnchor: () => undefined,
      registerCitationAnchor: () => undefined,
      scrollToEvidence: () => undefined,
      scrollToCitation: () => undefined,
      resolveCitationId: () => undefined
    };
  }
  return context;
}
