import React, { useCallback, useEffect, useRef } from "react";
import { evidenceArtifactAnchor } from "../../prompts/sourceCitationRegistry";
import {
  EvidenceCardExpandProvider,
  useEvidenceCardExpand,
  useSourcesFoldExpand
} from "../evidenceConnectionExpandContext";
import { useCitationNavigation } from "./CitationNavigationContext";

/** Registers the evidence Sources card shell for scroll-to-card navigation. */
export function EvidenceArtifactAnchor({
  artifactId,
  children
}: {
  artifactId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <EvidenceCardExpandProvider>
      <EvidenceArtifactAnchorInner artifactId={artifactId}>{children}</EvidenceArtifactAnchorInner>
    </EvidenceCardExpandProvider>
  );
}

function EvidenceArtifactAnchorInner({
  artifactId,
  children
}: {
  artifactId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { registerEvidenceAnchor } = useCitationNavigation();
  const expandCard = useEvidenceCardExpand()?.expand;
  const expandFold = useSourcesFoldExpand();
  const expand = useCallback(() => {
    expandFold?.();
    expandCard?.();
  }, [expandFold, expandCard]);

  useEffect(() => {
    registerEvidenceAnchor(evidenceArtifactAnchor(artifactId), rootRef.current, expand);
    return () => registerEvidenceAnchor(evidenceArtifactAnchor(artifactId), null);
  }, [artifactId, expand, registerEvidenceAnchor]);

  return <div ref={rootRef}>{children}</div>;
}
