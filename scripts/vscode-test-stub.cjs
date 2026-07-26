"use strict";

const Module = require("node:module");

class Range {
  constructor(...args) {
    this.args = args;
  }
}

class WorkspaceEdit {
  constructor() {
    this.replacements = [];
  }

  replace(uri, range, text) {
    this.replacements.push({ uri, range, text });
  }
}

class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}

const stub = {
  workspace: {
    workspaceFolders: [],
    textDocuments: [],
    asRelativePath(uri) {
      return uri.fsPath || uri.toString();
    },
    getWorkspaceFolder(uri) {
      if (!uri || uri.scheme !== "file") {
        return undefined;
      }
      const folders = stub.workspace.workspaceFolders ?? [];
      for (const folder of folders) {
        const root = folder.uri.fsPath.replace(/\\/g, "/");
        const candidate = (uri.fsPath || "").replace(/\\/g, "/");
        if (candidate === root || candidate.startsWith(`${root}/`)) {
          return folder;
        }
      }
      return undefined;
    },
    applyEdit() {
      return Promise.resolve(true);
    },
    getConfiguration(section) {
      return {
        get(_key, defaultValue) {
          return defaultValue;
        },
        update() {
          return Promise.resolve();
        }
      };
    },
    openTextDocument() {
      return Promise.reject(new Error("vscode stub: openTextDocument unavailable in tests"));
    },
    showTextDocument() {
      return Promise.reject(new Error("vscode stub: showTextDocument unavailable in tests"));
    },
    fs: {
      readFile() {
        return Promise.reject(new Error("vscode stub: fs.readFile unavailable in tests"));
      }
    }
  },
  window: {
    visibleTextEditors: [],
    tabGroups: { all: [] },
    showOpenDialog() {
      return Promise.resolve(undefined);
    },
    showSaveDialog() {
      return Promise.resolve(undefined);
    },
    showInformationMessage() {
      return Promise.resolve(undefined);
    },
    showWarningMessage() {
      return Promise.resolve(undefined);
    },
    showErrorMessage() {
      return Promise.resolve(undefined);
    },
    activeTextEditor: undefined
  },
  Uri: {
    file(filePath) {
      return { scheme: "file", fsPath: filePath, toString: () => `file://${filePath}` };
    },
    parse(value) {
      const scheme = value.split(":", 1)[0] || "";
      return { scheme, fsPath: "", toString: () => value };
    }
  },
  Range,
  WorkspaceEdit,
  TabInputText,
  ViewColumn: { One: 1, Beside: 2, Active: -1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
};

const originalLoad = Module._load;
Module._load = function vscodeStubLoader(request, parent, isMain) {
  if (request === "vscode") {
    return stub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
