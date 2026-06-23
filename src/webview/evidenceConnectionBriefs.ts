import React from "react";

export type EvidenceConnectionBrief = {
  title: string;
  sourceLabel?: string;
  sectionDomId?: string;
};

const COLLAPSIBLE_DISPLAY_NAME = "IntegrationResultCollapsible";

export function extractConnectionBriefs(children: React.ReactNode): EvidenceConnectionBrief[] {
  const briefs: EvidenceConnectionBrief[] = [];
  collectConnectionBriefs(children, briefs);
  return briefs;
}

function isCollapsibleElement(child: React.ReactElement): boolean {
  const type = child.type as { displayName?: string; name?: string };
  return type.displayName === COLLAPSIBLE_DISPLAY_NAME || type.name === COLLAPSIBLE_DISPLAY_NAME;
}

function collectConnectionBriefs(node: React.ReactNode, briefs: EvidenceConnectionBrief[]): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }

    if (isCollapsibleElement(child)) {
      const props = child.props as {
        title?: string;
        sourceLabel?: string;
        sectionDomId?: string;
      };
      if (props.title?.trim()) {
        briefs.push({
          title: props.title.trim(),
          sourceLabel: props.sourceLabel?.trim() || undefined,
          sectionDomId: props.sectionDomId?.trim() || undefined
        });
      }
      return;
    }

    if (child.props && typeof child.props === "object" && "children" in child.props) {
      collectConnectionBriefs(child.props.children as React.ReactNode, briefs);
    }
  });
}

export function resolveConnectionBrief(
  briefSummary: EvidenceConnectionBrief | undefined,
  children: React.ReactNode
): EvidenceConnectionBrief | undefined {
  if (briefSummary?.title) {
    return briefSummary;
  }

  const extracted = extractConnectionBriefs(children);
  return extracted.find((brief) => brief.sourceLabel) ?? extracted[0];
}

export function extractConnectionSectionDomIds(children: React.ReactNode): string[] {
  return extractConnectionBriefs(children)
    .map((brief) => brief.sectionDomId)
    .filter((value): value is string => Boolean(value));
}

/** When a connection group has exactly one collapsible section, flatten it on expand. */
export function findSingleCollapsibleElement(node: React.ReactNode): React.ReactElement | null {
  const collapsibles: React.ReactElement[] = [];
  let otherVisible = 0;
  collectCollapsibleInventory(node, collapsibles, () => {
    otherVisible += 1;
  });
  return collapsibles.length === 1 && otherVisible === 0 ? collapsibles[0]! : null;
}

function collectCollapsibleInventory(
  node: React.ReactNode,
  collapsibles: React.ReactElement[],
  onOtherVisible: () => void
): void {
  React.Children.forEach(node, (child) => {
    if (child === null || child === undefined || child === false) {
      return;
    }
    if (!React.isValidElement(child)) {
      onOtherVisible();
      return;
    }

    if (isCollapsibleElement(child)) {
      collapsibles.push(child);
      return;
    }

    if (child.props && typeof child.props === "object" && "children" in child.props) {
      collectCollapsibleInventory(child.props.children as React.ReactNode, collapsibles, onOtherVisible);
      return;
    }

    onOtherVisible();
  });
}

export function renderConnectionBody(children: React.ReactNode): React.ReactNode {
  const single = findSingleCollapsibleElement(children);
  if (!single) {
    return children;
  }

  return React.cloneElement(single, {
    open: true,
    hideHeader: true
  } as Partial<{ open: boolean; hideHeader: boolean }>);
}
