export type ManifestSymbol = {
  name: string;
  kind: "function" | "class" | "method" | "export";
};

export type ManifestFileEntry = {
  filePath: string;
  symbols: ManifestSymbol[];
};

export type StructureManifest = {
  repoId: string;
  files: ManifestFileEntry[];
  lastCrawledAt?: string;
};

/** Editor state passed from the VS Code extension for manifest scoring. */
export type EditorContext = {
  activeFile?: string;
  openEditors?: string[];
  selectedSymbol?: string;
  selectedLines?: [number, number];
  languageId?: string;
};

export type ScoredManifestFile = {
  filePath: string;
  score: number;
};
