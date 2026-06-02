import * as fs from "node:fs";
import { fromBinary } from "@bufbuild/protobuf";
import {
  IndexSchema,
  SymbolInformation_Kind,
  SymbolRole,
  type Occurrence
} from "@scip-code/scip";
import type { SymbolIndexKind, SymbolIndexRow, SymbolReferenceLocation } from "../indexing/repoSymbolIndexStore";

export function decodeScipIndexFile(indexPath: string): SymbolIndexRow[] {
  const bytes = fs.readFileSync(indexPath);
  const index = fromBinary(IndexSchema, new Uint8Array(bytes));
  return decodeScipIndex(index);
}

export function decodeScipIndex(index: ReturnType<typeof fromBinary<typeof IndexSchema>>): SymbolIndexRow[] {
  const kindBySymbol = new Map<string, SymbolIndexKind>();
  const displayBySymbol = new Map<string, string>();

  for (const document of index.documents) {
    for (const symbolInfo of document.symbols) {
      if (!symbolInfo.symbol) {
        continue;
      }
      kindBySymbol.set(symbolInfo.symbol, mapScipKind(symbolInfo.kind));
      if (symbolInfo.displayName) {
        displayBySymbol.set(symbolInfo.symbol, symbolInfo.displayName);
      }
    }
  }

  const definitionsBySymbol = new Map<string, SymbolIndexRow[]>();

  for (const document of index.documents) {
    const filePath = normalizePath(document.relativePath);
    if (!filePath) {
      continue;
    }

    for (const occurrence of document.occurrences) {
      if (!occurrence.symbol || !isDefinitionOccurrence(occurrence)) {
        continue;
      }

      const range = parseOccurrenceRange(occurrence);
      if (!range) {
        continue;
      }

      const row: SymbolIndexRow = {
        symbol: displayBySymbol.get(occurrence.symbol) ?? simplifySymbol(occurrence.symbol),
        filePath,
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        kind: kindBySymbol.get(occurrence.symbol) ?? inferKindFromSymbol(occurrence.symbol),
        references: []
      };

      const bucket = definitionsBySymbol.get(occurrence.symbol) ?? [];
      bucket.push(row);
      definitionsBySymbol.set(occurrence.symbol, bucket);
    }
  }

  for (const document of index.documents) {
    const filePath = normalizePath(document.relativePath);
    if (!filePath) {
      continue;
    }

    for (const occurrence of document.occurrences) {
      if (!occurrence.symbol || !isReferenceOccurrence(occurrence)) {
        continue;
      }

      const range = parseOccurrenceRange(occurrence);
      if (!range) {
        continue;
      }

      const reference: SymbolReferenceLocation = {
        file_path: filePath,
        line: range.lineStart
      };

      for (const row of definitionsBySymbol.get(occurrence.symbol) ?? []) {
        row.references.push(reference);
      }
    }
  }

  return [...definitionsBySymbol.values()]
    .flat()
    .map((row) => ({
      ...row,
      references: dedupeReferences(row.references)
    }));
}

function mapScipKind(kind: SymbolInformation_Kind): SymbolIndexKind {
  switch (kind) {
    case SymbolInformation_Kind.Class:
    case SymbolInformation_Kind.Interface:
    case SymbolInformation_Kind.Struct:
    case SymbolInformation_Kind.Enum:
    case SymbolInformation_Kind.Union:
    case SymbolInformation_Kind.Type:
    case SymbolInformation_Kind.TypeAlias:
    case SymbolInformation_Kind.TypeClass:
    case SymbolInformation_Kind.SingletonClass:
      return "class";
    case SymbolInformation_Kind.Method:
    case SymbolInformation_Kind.Function:
    case SymbolInformation_Kind.Constructor:
    case SymbolInformation_Kind.StaticMethod:
    case SymbolInformation_Kind.AbstractMethod:
    case SymbolInformation_Kind.Accessor:
    case SymbolInformation_Kind.Getter:
    case SymbolInformation_Kind.Setter:
    case SymbolInformation_Kind.Macro:
      return "function";
    default:
      return "variable";
  }
}

function inferKindFromSymbol(symbol: string): SymbolIndexKind {
  if (symbol.includes("#")) {
    return "class";
  }
  if (symbol.includes("().")) {
    return "function";
  }
  return "variable";
}

function simplifySymbol(symbol: string): string {
  const localMatch = symbol.match(/^local\s+(\S+)/);
  if (localMatch?.[1]) {
    return localMatch[1];
  }
  const methodMatch = symbol.match(/([A-Za-z0-9_$]+)\(\)\./);
  if (methodMatch?.[1]) {
    return methodMatch[1];
  }
  const termMatch = symbol.match(/([A-Za-z0-9_$]+)\.$/);
  if (termMatch?.[1]) {
    return termMatch[1];
  }
  return symbol;
}

function isDefinitionOccurrence(occurrence: Occurrence): boolean {
  const roles = occurrence.symbolRoles ?? 0;
  return (
    (roles & SymbolRole.Definition) !== 0 ||
    (roles & SymbolRole.ForwardDefinition) !== 0
  );
}

function isReferenceOccurrence(occurrence: Occurrence): boolean {
  const roles = occurrence.symbolRoles ?? 0;
  if (isDefinitionOccurrence(occurrence)) {
    return false;
  }
  if (roles === 0) {
    return true;
  }
  return (
    (roles & SymbolRole.Import) !== 0 ||
    (roles & SymbolRole.ReadAccess) !== 0 ||
    (roles & SymbolRole.WriteAccess) !== 0
  );
}

function parseOccurrenceRange(
  occurrence: Occurrence
): { lineStart: number; lineEnd: number } | undefined {
  const range = occurrence.range;
  if (!range || range.length < 3) {
    return undefined;
  }

  const startLine = range[0];
  if (startLine === undefined) {
    return undefined;
  }

  const endLine = range.length >= 4 ? range[2] : startLine;
  if (endLine === undefined) {
    return undefined;
  }

  // SCIP line numbers are 0-based; store 1-based for API consumers.
  return {
    lineStart: startLine + 1,
    lineEnd: Math.max(startLine, endLine) + 1
  };
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function dedupeReferences(references: SymbolReferenceLocation[]): SymbolReferenceLocation[] {
  const seen = new Set<string>();
  const deduped: SymbolReferenceLocation[] = [];
  for (const reference of references) {
    const key = `${reference.file_path}:${reference.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(reference);
  }
  return deduped;
}
