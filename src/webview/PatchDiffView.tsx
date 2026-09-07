import React from "react";
import type {
  PatchDiffLine,
  PatchMatchLocation,
  PatchPreviewFile,
  PatchPreviewHunk,
  PatchSharedMatchGroup,
  PatchSharedMatchLocation
} from "../chat/types";
import { IntegrationResultNested, IntegrationResultText } from "./components/IntegrationResultCard";
import { formatFileLocation, formatHunkLocation } from "./patchLocationLabel";

type PatchDiffViewProps = {
  files: PatchPreviewFile[];
  onOpenFile?: (path: string) => void;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onToggleMatchLocation?: (hunkId: string, locationId: string, selected: boolean) => void;
  onSelectSharedProposal?: (
    relativePath: string,
    groupId: string,
    locationId: string,
    proposalId: string | null
  ) => void;
};

export function PatchDiffView({
  files,
  onOpenFile,
  onApplyHunk,
  onRejectHunk,
  onToggleMatchLocation,
  onSelectSharedProposal
}: PatchDiffViewProps): React.ReactElement {
  return (
    <div className="coop-patch-diff-stack">
      {files.map((file) => (
        <PatchFileDiff
          key={file.relativePath}
          file={file}
          onOpenFile={onOpenFile}
          onApplyHunk={onApplyHunk}
          onRejectHunk={onRejectHunk}
          onToggleMatchLocation={onToggleMatchLocation}
          onSelectSharedProposal={onSelectSharedProposal}
        />
      ))}
    </div>
  );
}

function hunkIdsInSharedGroups(file: PatchPreviewFile): Set<string> {
  return new Set((file.sharedMatchGroups ?? []).flatMap((group) => group.hunkIds));
}

function PatchFileDiff({
  file,
  onOpenFile,
  onApplyHunk,
  onRejectHunk,
  onToggleMatchLocation,
  onSelectSharedProposal
}: {
  file: PatchPreviewFile;
  onOpenFile?: (path: string) => void;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onToggleMatchLocation?: (hunkId: string, locationId: string, selected: boolean) => void;
  onSelectSharedProposal?: (
    relativePath: string,
    groupId: string,
    locationId: string,
    proposalId: string | null
  ) => void;
}): React.ReactElement {
  const sharedHunkIds = hunkIdsInSharedGroups(file);
  const standaloneHunks = file.hunks.filter((hunk) => !sharedHunkIds.has(hunk.id));
  const fileLocation = formatFileLocation(file);

  return (
    <div className="coop-patch-file">
      <div className="coop-patch-file-header">
        <div className="coop-patch-file-heading">
          <span className="coop-patch-file-path">{file.relativePath}</span>
          {fileLocation ? <span className="coop-patch-file-anchor">{fileLocation}</span> : null}
        </div>
        {onOpenFile ? (
          <button type="button" className="coop-text-btn" onClick={() => onOpenFile(file.relativePath)}>
            Open file
          </button>
        ) : null}
      </div>
      <IntegrationResultNested className="coop-patch-file-body">
        {(file.sharedMatchGroups ?? []).map((group) => (
          <SharedMatchGroupView
            key={group.id}
            relativePath={file.relativePath}
            group={group}
            hunks={file.hunks}
            onSelectSharedProposal={onSelectSharedProposal}
          />
        ))}
        {standaloneHunks.map((hunk) => (
          <PatchHunkDiff
            key={hunk.id}
            hunk={hunk}
            hideWhere={Boolean(fileLocation)}
            onApplyHunk={onApplyHunk}
            onRejectHunk={onRejectHunk}
            onToggleMatchLocation={onToggleMatchLocation}
          />
        ))}
      </IntegrationResultNested>
    </div>
  );
}

function selectedLocationCount(hunk: PatchPreviewHunk): number {
  return hunk.matchLocations?.filter((loc) => loc.selected).length ?? 0;
}

function PatchHunkDiff({
  hunk,
  hideWhere,
  onApplyHunk,
  onRejectHunk,
  onToggleMatchLocation
}: {
  hunk: PatchPreviewHunk;
  hideWhere?: boolean;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onToggleMatchLocation?: (hunkId: string, locationId: string, selected: boolean) => void;
}): React.ReactElement {
  const status = hunk.status ?? "pending";
  const showActions = status === "pending" && (onApplyHunk || onRejectHunk);
  const isAmbiguous = hunk.matchStatus === "ambiguous" && (hunk.matchLocations?.length ?? 0) > 1;
  const selectedCount = selectedLocationCount(hunk);
  const canApply =
    hunk.matchStatus === "matched" ||
    Boolean(hunk.resolvedMatchIndices?.length) ||
    (isAmbiguous && selectedCount > 0);
  const where = hideWhere ? undefined : formatHunkLocation(hunk);

  return (
    <div className={`coop-patch-hunk${status !== "pending" ? ` coop-patch-hunk--${status}` : ""}`}>
      {where ? (
        <div className="coop-patch-hunk-where">
          {where}
          {status === "applied" ? " · applied" : status === "rejected" ? " · rejected" : ""}
        </div>
      ) : null}
      {hunk.matchStatus === "not_found" ? (
        <IntegrationResultText muted>
          SEARCH block not found — review before applying.
        </IntegrationResultText>
      ) : null}
      {isAmbiguous ? (
        <IntegrationResultText muted>
          Matches {hunk.matchLocations!.length} places — select one or more, then Apply.
          {selectedCount > 0 ? ` (${selectedCount} selected)` : ""}
        </IntegrationResultText>
      ) : null}
      {status === "applied" && !where ? (
        <IntegrationResultText muted>Applied</IntegrationResultText>
      ) : null}
      {status === "rejected" && !where ? (
        <IntegrationResultText muted>Rejected</IntegrationResultText>
      ) : null}

      {isAmbiguous ? (
        <div className="coop-patch-match-list">
          {hunk.matchLocations!.map((location, index) => (
            <PatchMatchLocationOption
              key={location.id}
              hunkId={hunk.id}
              index={index}
              location={location}
              selectable={status === "pending"}
              onToggle={onToggleMatchLocation}
            />
          ))}
        </div>
      ) : (
        <pre className="coop-patch-diff">
          <code>
            {hunk.lines.map((line, index) => (
              <PatchDiffLineRow key={`${hunk.id}-${index}`} line={line} />
            ))}
          </code>
        </pre>
      )}

      {showActions ? (
        <div className="coop-patch-hunk-actions">
          {onApplyHunk ? (
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onApplyHunk(hunk.id)}
              disabled={!canApply}
            >
              Apply{isAmbiguous && selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
          ) : null}
          {onRejectHunk ? (
            <button type="button" className="coop-text-btn" onClick={() => onRejectHunk(hunk.id)}>
              Reject
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SharedMatchGroupView({
  relativePath,
  group,
  hunks,
  onSelectSharedProposal
}: {
  relativePath: string;
  group: PatchSharedMatchGroup;
  hunks: PatchPreviewHunk[];
  onSelectSharedProposal?: (
    relativePath: string,
    groupId: string,
    locationId: string,
    proposalId: string | null
  ) => void;
}): React.ReactElement {
  const memberHunks = group.hunkIds
    .map((id) => hunks.find((hunk) => hunk.id === id))
    .filter((hunk): hunk is PatchPreviewHunk => Boolean(hunk));
  const pending = memberHunks.some((hunk) => (hunk.status ?? "pending") === "pending");
  const selectedCount = group.locations.filter((location) => location.selectedProposalId).length;
  const allApplied = memberHunks.every((hunk) => hunk.status === "applied");
  const allRejected = memberHunks.every((hunk) => hunk.status === "rejected");

  return (
    <div
      className={`coop-patch-hunk${allApplied ? " coop-patch-hunk--applied" : ""}${
        allRejected ? " coop-patch-hunk--rejected" : ""
      }`}
    >
      {pending ? (
        <IntegrationResultText muted>
          Matches {group.locations.length} places — pick one edit per place (same line can’t get two
          edits).
          {selectedCount > 0 ? ` (${selectedCount} selected)` : ""}
        </IntegrationResultText>
      ) : null}
      {allApplied ? <IntegrationResultText muted>Applied</IntegrationResultText> : null}
      {allRejected ? <IntegrationResultText muted>Rejected</IntegrationResultText> : null}

      <div className="coop-patch-match-list">
        {group.locations.map((location, index) => (
          <SharedMatchLocationOption
            key={location.id}
            relativePath={relativePath}
            groupId={group.id}
            index={index}
            location={location}
            selectable={pending}
            onSelectSharedProposal={onSelectSharedProposal}
          />
        ))}
      </div>
    </div>
  );
}

function SharedMatchLocationOption({
  relativePath,
  groupId,
  index,
  location,
  selectable,
  onSelectSharedProposal
}: {
  relativePath: string;
  groupId: string;
  index: number;
  location: PatchSharedMatchLocation;
  selectable: boolean;
  onSelectSharedProposal?: (
    relativePath: string,
    groupId: string,
    locationId: string,
    proposalId: string | null
  ) => void;
}): React.ReactElement {
  const lineLabel =
    location.startLine === location.endLine
      ? `L${location.startLine}`
      : `L${location.startLine}–${location.endLine}`;
  const selectedProposal =
    location.proposals.find((proposal) => proposal.id === location.selectedProposalId) ??
    location.proposals[0];
  const checked = Boolean(location.selectedProposalId);
  const multiProposal = location.proposals.length > 1;

  return (
    <div
      className={`coop-patch-match-option${checked ? " coop-patch-match-option--selected" : ""}`}
    >
      <div className="coop-patch-match-option-header">
        <input
          type="checkbox"
          className="coop-patch-match-checkbox"
          checked={checked}
          disabled={!selectable || !onSelectSharedProposal || !selectedProposal}
          onChange={(event) => {
            if (!selectedProposal || !onSelectSharedProposal) {
              return;
            }
            onSelectSharedProposal(
              relativePath,
              groupId,
              location.id,
              event.target.checked ? selectedProposal.id : null
            );
          }}
        />
        <span className="coop-patch-match-option-title">
          Option {index + 1} · {lineLabel}
        </span>
      </div>
      {multiProposal && selectable ? (
        <div className="coop-patch-match-proposals">
          {location.proposals.map((proposal, proposalIndex) => {
            const inputId = `${groupId}-${location.id}-${proposal.id}`;
            return (
              <label key={proposal.id} className="coop-patch-match-proposal" htmlFor={inputId}>
                <input
                  id={inputId}
                  type="radio"
                  name={`${groupId}-${location.id}`}
                  checked={location.selectedProposalId === proposal.id}
                  disabled={!onSelectSharedProposal}
                  onChange={() =>
                    onSelectSharedProposal?.(relativePath, groupId, location.id, proposal.id)
                  }
                />
                <span>Edit {proposalIndex + 1}</span>
              </label>
            );
          })}
        </div>
      ) : null}
      {selectedProposal ? (
        <pre className="coop-patch-diff">
          <code>
            {selectedProposal.lines.map((line, lineIndex) => (
              <PatchDiffLineRow key={`${selectedProposal.id}-${lineIndex}`} line={line} />
            ))}
          </code>
        </pre>
      ) : null}
    </div>
  );
}

function PatchMatchLocationOption({
  hunkId,
  index,
  location,
  selectable,
  onToggle
}: {
  hunkId: string;
  index: number;
  location: PatchMatchLocation;
  selectable: boolean;
  onToggle?: (hunkId: string, locationId: string, selected: boolean) => void;
}): React.ReactElement {
  const lineLabel =
    location.startLine === location.endLine
      ? `L${location.startLine}`
      : `L${location.startLine}–${location.endLine}`;
  const checked = Boolean(location.selected);
  const inputId = `${hunkId}-${location.id}`;

  return (
    <label
      className={`coop-patch-match-option${checked ? " coop-patch-match-option--selected" : ""}`}
      htmlFor={inputId}
    >
      <div className="coop-patch-match-option-header">
        <input
          id={inputId}
          type="checkbox"
          className="coop-patch-match-checkbox"
          checked={checked}
          disabled={!selectable || !onToggle}
          onChange={(event) => onToggle?.(hunkId, location.id, event.target.checked)}
        />
        <span className="coop-patch-match-option-title">
          Option {index + 1} · {lineLabel}
        </span>
      </div>
      <pre className="coop-patch-diff">
        <code>
          {location.lines.map((line, lineIndex) => (
            <PatchDiffLineRow key={`${location.id}-${lineIndex}`} line={line} />
          ))}
        </code>
      </pre>
    </label>
  );
}

function PatchDiffLineRow({ line }: { line: PatchDiffLine }): React.ReactElement {
  const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  const lineLabel = line.lineNumber !== undefined ? String(line.lineNumber).padStart(4, " ") : "    ";

  return (
    <div className={`coop-patch-line coop-patch-line--${line.kind}`}>
      <span className="coop-patch-gutter">{lineLabel}</span>
      <span className="coop-patch-marker">{prefix}</span>
      <span className="coop-patch-text">{line.text || " "}</span>
    </div>
  );
}
