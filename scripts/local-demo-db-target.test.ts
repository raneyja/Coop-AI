import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalDemoDatabaseTarget } from "./local-demo-db-target";

test("analytics demo seed admits explicit local targets without connecting", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "postgres"]) {
    assert.doesNotThrow(() => assertLocalDemoDatabaseTarget(`postgres://demo:local@${host}:5432/coopai`));
  }
});

test("analytics demo seed rejects remote hosts and connection overrides", () => {
  const base = "postgres://demo:local@localhost:5432/coopai";
  for (const target of [
    "postgres://demo:local@localhost.attacker.invalid:5432/coopai",
    "postgres://demo:localhost@remote.invalid:5432/coopai",
    "postgres://demo:local@remote.invalid:5432/coopai?host=localhost",
    base + "?host=remote.invalid",
    base + "?HOST=remote.invalid",
    base + "?%68ost=remote.invalid",
    base + "#ignored",
    base.replace("postgres:", "https:"),
    base.replace("/coopai", "/")
  ]) {
    assert.throws(() => assertLocalDemoDatabaseTarget(target), /local|PostgreSQL/);
  }
});
