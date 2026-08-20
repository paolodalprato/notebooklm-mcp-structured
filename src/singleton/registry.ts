/**
 * Singleton registry: singleton.json (backend endpoint + token) and
 * singleton.lock (spawn lock) in the data dir. All reads are validated;
 * corrupt files are treated as absent.
 */
import fsp from "node:fs/promises";
import path from "node:path";

export interface SingletonInfo {
  port: number;
  token: string;
  pid: number;
  version: string;
  startedAt: string;
}

export function infoPath(dataDir: string): string {
  return path.join(dataDir, "singleton.json");
}

export function lockPath(dataDir: string): string {
  return path.join(dataDir, "singleton.lock");
}

/** Signal 0 probes existence without touching the process. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readInfo(dataDir: string): Promise<SingletonInfo | null> {
  try {
    const data = JSON.parse(await fsp.readFile(infoPath(dataDir), "utf-8"));
    if (
      typeof data?.port !== "number" ||
      typeof data?.token !== "string" ||
      typeof data?.pid !== "number" ||
      typeof data?.version !== "string" ||
      typeof data?.startedAt !== "string"
    ) {
      return null;
    }
    return data as SingletonInfo;
  } catch {
    return null;
  }
}

/** Temp file + rename: readers never observe a half-written file. */
export async function writeInfoAtomic(dataDir: string, info: SingletonInfo): Promise<void> {
  const target = infoPath(dataDir);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(info, null, 2), "utf-8");
  await fsp.rename(tmp, target);
}

export async function removeInfo(dataDir: string): Promise<void> {
  try {
    await fsp.unlink(infoPath(dataDir));
  } catch {
    // absent is fine
  }
}

/**
 * Remove singleton.json only if it still matches the copy the caller
 * validated. Guards against deleting a newer backend's registration
 * written between the caller's read and this call.
 */
export async function removeInfoIfOwn(
  dataDir: string,
  expected: Pick<SingletonInfo, "pid" | "startedAt">
): Promise<boolean> {
  const current = await readInfo(dataDir);
  if (!current) return false;
  if (current.pid !== expected.pid || current.startedAt !== expected.startedAt) return false;
  await removeInfo(dataDir);
  return true;
}

/** True when this process now holds the lock. A lock whose holder is dead is stolen. */
export async function acquireSpawnLock(dataDir: string): Promise<boolean> {
  const p = lockPath(dataDir);
  try {
    await fsp.writeFile(p, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      const holder = Number.parseInt(await fsp.readFile(p, "utf-8"), 10);
      if (!Number.isNaN(holder) && isPidAlive(holder)) return false;
      await fsp.unlink(p);
      await fsp.writeFile(p, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

export async function releaseSpawnLock(dataDir: string): Promise<void> {
  try {
    await fsp.unlink(lockPath(dataDir));
  } catch {
    // absent is fine
  }
}
