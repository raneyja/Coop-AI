import Module from "node:module";

type MockPosition = { line: number; character: number };

type MockTextDocument = {
  uri: { fsPath: string; scheme: string };
  languageId: string;
  getText: (range?: { start: MockPosition; end: MockPosition }) => string;
  offsetAt: (position: MockPosition) => number;
  lineAt?: (line: number) => { text: string };
};

type MockExtension = {
  id: string;
  isActive: boolean;
};

const mockConfigValues = new Map<string, unknown>();
const mockExtensions = new Map<string, MockExtension>();
const configUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];
const globalState = new Map<string, unknown>();
let mockInformationMessageChoice: string | undefined;
const executedCommands: unknown[][] = [];
let mockExecuteCommandHandler: ((...args: unknown[]) => Promise<unknown>) | undefined;

export function setMockExecuteCommandHandler(
  handler: ((...args: unknown[]) => Promise<unknown>) | undefined
): void {
  mockExecuteCommandHandler = handler;
}

export function setMockInformationMessageChoice(choice: string | undefined): void {
  mockInformationMessageChoice = choice;
}

export function getMockExecutedCommands(): ReadonlyArray<readonly unknown[]> {
  return executedCommands;
}

function configKey(section: string | undefined, key: string): string {
  return `${section ?? ""}:${key}`;
}

export function setMockConfiguration(section: string | undefined, key: string, value: unknown): void {
  mockConfigValues.set(configKey(section, key), value);
}

export function resetMockConfiguration(): void {
  mockConfigValues.clear();
  mockExtensions.clear();
  configUpdates.length = 0;
  globalState.clear();
  mockInformationMessageChoice = undefined;
  executedCommands.length = 0;
  mockExecuteCommandHandler = undefined;
}

export function getMockConfigUpdates(): ReadonlyArray<{ key: string; value: unknown; target: unknown }> {
  return configUpdates;
}

export function clearMockConfigUpdates(): void {
  configUpdates.length = 0;
}

export function setMockExtension(id: string, options: { isActive?: boolean } = {}): void {
  mockExtensions.set(id, { id, isActive: options.isActive ?? false });
}

export function createMockExtensionContext(): {
  globalState: {
    get: <T>(key: string, defaultValue?: T) => T | undefined;
    update: (key: string, value: unknown) => Promise<void>;
  };
} {
  return {
    globalState: {
      get<T>(key: string, defaultValue?: T): T | undefined {
        if (globalState.has(key)) {
          return globalState.get(key) as T;
        }
        return defaultValue;
      },
      async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
          globalState.delete(key);
        } else {
          globalState.set(key, value);
        }
      }
    }
  };
}

const vscodeMock = {
  InlineCompletionTriggerKind: { Automatic: 0, Invoke: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  CompletionItemKind: {
    Text: 0,
    Method: 1,
    Function: 2,
    Constructor: 3,
    Field: 4,
    Variable: 5,
    Class: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Unit: 10,
    Value: 11,
    Enum: 12,
    Keyword: 13,
    Snippet: 14,
    Color: 15,
    File: 16,
    Reference: 17,
    Folder: 18,
    EnumMember: 19,
    Constant: 20,
    Struct: 21,
    Event: 22,
    Operator: 23,
    TypeParameter: 24
  },
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
    getWorkspaceFolder: () => ({ uri: { fsPath: "/workspace" } }),
    getConfiguration: (section?: string) => ({
      get: <T>(key: string, defaultValue: T): T => {
        const stored = mockConfigValues.get(configKey(section, key));
        return stored !== undefined ? (stored as T) : defaultValue;
      },
      inspect: <T>(key: string) => {
        const value = mockConfigValues.get(configKey(section, key));
        if (value === undefined) {
          return undefined;
        }
        return {
          key,
          defaultValue: undefined,
          globalValue: value as T,
          workspaceValue: undefined,
          workspaceFolderValue: undefined
        };
      },
      async update(key: string, value: unknown, target: unknown): Promise<void> {
        configUpdates.push({ key, value, target });
        mockConfigValues.set(configKey(section, key), value);
      }
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    asRelativePath: (uri: { fsPath?: string } | string) => {
      const path = typeof uri === "string" ? uri : (uri.fsPath ?? "");
      return path.replace(/^\/workspace\/?/, "");
    }
  },
  extensions: {
    getExtension: (id: string) => {
      const ext = mockExtensions.get(id);
      if (!ext) {
        return undefined;
      }
      return { id: ext.id, isActive: ext.isActive };
    },
    onDidChange: () => ({ dispose: () => undefined })
  },
  commands: {
    executeCommand: async (...args: unknown[]) => {
      executedCommands.push(args);
      if (mockExecuteCommandHandler) {
        return mockExecuteCommandHandler(...args);
      }
      return args;
    }
  },
  window: {
    visibleTextEditors: [] as Array<{ document: { uri: { fsPath: string } } }>,
    showInformationMessage: async () => mockInformationMessageChoice
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
  },
  CompletionItem: class {
    label: string;
    kind?: number;
    insertText?: string | { value: string };
    textEdit?: { newText: string; range?: unknown };

    constructor(label: string, kind?: number) {
      this.label = label;
      this.kind = kind;
    }
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
