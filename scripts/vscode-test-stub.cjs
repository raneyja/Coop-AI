"use strict";

const Module = require("node:module");

const stub = {
  workspace: {
    workspaceFolders: [],
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
      return { fsPath: filePath, toString: () => filePath };
    }
  },
  ViewColumn: { One: 1, Beside: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
};

const originalLoad = Module._load;
Module._load = function vscodeStubLoader(request, parent, isMain) {
  if (request === "vscode") {
    return stub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
