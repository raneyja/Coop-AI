import React, { useEffect, useRef } from "react";
import { evidenceArtifactAnchor } from "../../prompts/sourceCitationRegistry";
import { useCitationNavigation } from "./CitationNavigationContext";

/** Registers the evidence Sources card shell for scroll-to-card navigation. */
export function EvidenceArtifactAnchor({
  artifactId,
  children
}: {
  artifactId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { registerEvidenceAnchor } = useCitationNavigation();

  useEffect(() => {
    registerEvidenceAnchor(evidenceArtifactAnchor(artifactId), rootRef.current);
    return () => registerEvidenceAnchor(evidenceArtifactAnchor(artifactId), null);
  }, [artifactId, registerEvidenceAnchor]);

  return <div ref={rootRef}>{children}</div>;
}
