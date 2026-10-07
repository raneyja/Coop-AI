import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

type LaunchConfiguration = {
  type?: string;
  args?: string[];
};

type LaunchFile = {
  configurations?: LaunchConfiguration[];
};

test("development extension host does not disable CoopAI itself", () => {
  const launchPath = path.join(process.cwd(), ".vscode", "launch.json");
  const launch = JSON.parse(fs.readFileSync(launchPath, "utf8")) as LaunchFile;

  for (const configuration of launch.configurations ?? []) {
    if (configuration.type !== "extensionHost") {
      continue;
    }
    assert.ok(
      !(configuration.args ?? []).includes("--disable-extension=coop-ai.coop-ai"),
      "Extension Host launch configs must not disable the development extension"
    );
  }
});
