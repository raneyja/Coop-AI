import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteExplorerTreePanel, type ExplorerTreeState } from "./RemoteExplorerTree";

function render(treeState: ExplorerTreeState): string {
  return renderToStaticMarkup(<RemoteExplorerTreePanel
    treeState={treeState} searchState={{ query: "", items: [] }} context={{}}
    onRefreshRepos={() => {}} onRefreshPath={() => {}} onBrowseRepos={() => {}}
    onExpand={() => {}} onSearch={() => {}} onOpenRepo={() => {}}
  />);
}

const loading = render({ path: "", items: [], scope: "repos", loading: true });
assert.match(loading, /Loading repositories/);
assert.doesNotMatch(loading, /No repositories|Connect GitHub/);

const populated = render({ path: "", scope: "repos", items: [
  { path: "gitlab:fixture/project", name: "fixture/project", type: "repo" }
] });
assert.match(populated, /fixture\/project/);
assert.doesNotMatch(populated, /No repositories|Connect GitHub/);

const empty = render({ path: "", scope: "repos", items: [] });
assert.match(empty, /No repositories were returned/);
assert.doesNotMatch(empty, /Connect GitHub/);

const failed = render({ path: "", scope: "repos", items: [], error: "Sign in to load your repositories." });
assert.match(failed, /Sign in to load/);
assert.doesNotMatch(failed, /No repositories|Connect GitHub/);
console.log("RemoteExplorerTree: 4/4 passed");
