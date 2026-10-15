import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadReplaySession } from "../src/core/session-replay.js";

test("session replay keeps timing and applies speed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nightwire-"));
  const file = join(dir, "session.jsonl");

  const frames = [
    { id:1, at:"2026-10-15T08:00:00.000Z", timestamp:1000, direction:"out", kind:"json", bytes:7, preview:"one", payload:"{\"n\":1}" },
    { id:2, at:"2026-10-15T08:00:01.000Z", timestamp:2000, direction:"out", kind:"text", bytes:3, preview:"two", payload:"two" },
    { id:3, at:"2026-10-15T08:00:02.000Z", timestamp:3000, direction:"in", kind:"text", bytes:5, preview:"three", payload:"three" }
  ];

  await writeFile(file, frames.map(JSON.stringify).join("\n"), "utf8");

  const replay = await loadReplaySession(file, { speed: 2, direction: "out" });

  assert.equal(replay.length, 2);
  assert.equal(replay[0].delayMs, 0);
  assert.equal(replay[1].delayMs, 500);
  assert.equal(replay[1].frame.payload, "two");

  await rm(dir, { recursive: true, force: true });
});

test("session replay rejects broken JSONL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nightwire-"));
  const file = join(dir, "broken.jsonl");
  await writeFile(file, "{broken", "utf8");

  await assert.rejects(
    loadReplaySession(file, { speed: 1, direction: "out" }),
    /Invalid JSONL/
  );

  await rm(dir, { recursive: true, force: true });
});
