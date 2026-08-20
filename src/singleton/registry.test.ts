import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readInfo, writeInfoAtomic, removeInfo, removeInfoIfOwn, acquireSpawnLock, releaseSpawnLock, isPidAlive, lockPath } from "./registry.js";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "nlm-registry-"));
}
const info = { port: 4321, token: "t".repeat(64), pid: process.pid, version: "1.1.0", startedAt: new Date().toISOString() };

test("readInfo returns null when the file is absent", async () => {
  assert.equal(await readInfo(await tmpDir()), null);
});

test("write then read round-trips", async () => {
  const dir = await tmpDir();
  await writeInfoAtomic(dir, info);
  assert.deepEqual(await readInfo(dir), info);
});

test("readInfo returns null on corrupt json", async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, "singleton.json"), "{nope");
  assert.equal(await readInfo(dir), null);
});

test("readInfo returns null on wrong shape", async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, "singleton.json"), JSON.stringify({ port: "80" }));
  assert.equal(await readInfo(dir), null);
});

test("removeInfo tolerates a missing file", async () => {
  await removeInfo(await tmpDir()); // must not throw
});

test("lock: second acquire fails while holder is alive", async () => {
  const dir = await tmpDir();
  assert.equal(await acquireSpawnLock(dir), true);
  assert.equal(await acquireSpawnLock(dir), false); // holder = this live process
  await releaseSpawnLock(dir);
  assert.equal(await acquireSpawnLock(dir), true);
});

test("lock: stale lock from a dead pid is stolen", async () => {
  const dir = await tmpDir();
  await fs.writeFile(lockPath(dir), "999999999"); // no such pid
  assert.equal(await acquireSpawnLock(dir), true);
});

test("isPidAlive", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(999999999), false);
});

test("removeInfoIfOwn removes when pid+startedAt match", async () => {
  const dir = await tmpDir();
  await writeInfoAtomic(dir, info);
  assert.equal(await removeInfoIfOwn(dir, { pid: info.pid, startedAt: info.startedAt }), true);
  assert.equal(await readInfo(dir), null);
});

test("removeInfoIfOwn leaves the file and returns false when the current file differs", async () => {
  const dir = await tmpDir();
  await writeInfoAtomic(dir, info);
  // A newer backend wrote its own registration between the caller's read and this call.
  const newer = { ...info, pid: info.pid + 1, startedAt: new Date(Date.now() + 1000).toISOString() };
  await writeInfoAtomic(dir, newer);
  assert.equal(await removeInfoIfOwn(dir, { pid: info.pid, startedAt: info.startedAt }), false);
  assert.deepEqual(await readInfo(dir), newer);
});

test("removeInfoIfOwn returns false when the file is absent", async () => {
  const dir = await tmpDir();
  assert.equal(await removeInfoIfOwn(dir, { pid: info.pid, startedAt: info.startedAt }), false);
});
