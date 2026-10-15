import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package exposes nightwire CLI", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.bin.nightwire, "./dist/cli.js");
});

test("requires Node 20 or newer", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(pkg.engines.node, />=20/);
});
