import Module from "node:module";

type MockPosition = { line: number; character: number };

type MockTextDocument = {
  uri: { fsPath: string; scheme: string };
  languageId: string;
  getText: (range?: { start: MockPosition; end: MockPosition }) => string;
  offsetAt: (position: MockPosition) => number;
  lineAt?: (line: number) => { text: string };
};

const vscodeMock = {
  InlineCompletionTriggerKind: { Automatic: 0, Invoke: 1 },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: "file", toString: () => path })
  },
  Position: class {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  Range: class {
    constructor(
      public start: MockPosition,
      public end: MockPosition
    ) {}
  },
  workspace: {
    getWorkspaceFolder: () => undefined,
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) => defaultValue
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined })
  },
  extensions: {
    getExtension: () => undefined,
    onDidChange: () => ({ dispose: () => undefined })
  },
  commands: {
    executeCommand: async () => undefined
  },
  languages: {
    registerInlineCompletionItemProvider: () => ({ dispose: () => undefined })
  },
  InlineCompletionItem: class {
    constructor(
      public insertText: string,
      public range: unknown
    ) {}
    filterText?: string;
    command?: { title: string; command: string; arguments?: unknown[] };
  }
};

export type { MockTextDocument, MockPosition };

export function createMockDocument(
  text: string,
  options: { languageId?: string; path?: string } = {}
): MockTextDocument {
  const lines = text.split(/\r?\n/);
  return {
    uri: {
      fsPath: options.path ?? "/workspace/src/example.ts",
      scheme: "file"
    },
    languageId: options.languageId ?? "typescript",
    getText(range?: { start: MockPosition; end: MockPosition }) {
      if (!range) {
        return text;
      }
      const startOffset = this.offsetAt(range.start);
      const endOffset = this.offsetAt(range.end);
      return text.slice(startOffset, endOffset);
    },
    offsetAt(position: MockPosition) {
      let offset = 0;
      for (let i = 0; i < position.line; i += 1) {
        offset += (lines[i]?.length ?? 0) + 1;
      }
      return offset + position.character;
    },
    lineAt(line: number) {
      return { text: lines[line] ?? "" };
    }
  };
}

const originalRequire = Module.prototype.require;
Module.prototype.require = function (this: NodeModule, id: string) {
  if (id === "vscode") {
    return vscodeMock;
  }
  return originalRequire.call(this, id);
} as typeof Module.prototype.require;
