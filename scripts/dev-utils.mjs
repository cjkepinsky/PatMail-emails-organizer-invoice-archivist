import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const rootDir = process.cwd();
export const localDir = path.join(rootDir, ".local");
export const pidFile = path.join(localDir, "dev.pid");
export const logFile = path.join(localDir, "dev.log");
export const ports = [8797, 5181];

const execFileAsync = promisify(execFile);

export function ensureLocalDir() {
  fs.mkdirSync(localDir, { recursive: true });
}

export function readPid() {
  try {
    const value = fs.readFileSync(pidFile, "utf8").trim();
    const pid = Number(value);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(pid) {
  ensureLocalDir();
  fs.writeFileSync(pidFile, `${pid}\n`);
}

export function removePid() {
  try {
    fs.rmSync(pidFile);
  } catch {
    // Already gone.
  }
}

export function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function portPids() {
  const all = new Set();
  for (const port of ports) {
    try {
      const { stdout } = await execFileAsync("lsof", [
        "-nP",
        `-iTCP:${port}`,
        "-sTCP:LISTEN",
        "-t"
      ]);
      stdout
        .split(/\s+/)
        .map(value => Number(value))
        .filter(Boolean)
        .forEach(pid => all.add(pid));
    } catch (error) {
      if (error.code !== 1) throw error;
    }
  }
  return [...all];
}

export async function processTable() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="]);
  return stdout
    .split("\n")
    .map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3]
      };
    })
    .filter(Boolean);
}

export function relatedDevPids(table, seedPids) {
  const byPid = new Map(table.map(row => [row.pid, row]));
  const children = new Map();
  for (const row of table) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }

  const related = new Set(seedPids);
  for (const pid of seedPids) {
    let current = byPid.get(pid);
    while (current) {
      if (isDevCommand(current.command)) related.add(current.pid);
      const parent = byPid.get(current.ppid);
      if (!parent || !isDevCommand(parent.command)) break;
      current = parent;
    }
  }

  const queue = [...related];
  while (queue.length > 0) {
    const pid = queue.shift();
    for (const child of children.get(pid) || []) {
      const childRow = byPid.get(child);
      if (!childRow || related.has(child)) continue;
      if (isDevCommand(childRow.command)) {
        related.add(child);
        queue.push(child);
      }
    }
  }

  return [...related];
}

function isDevCommand(command) {
  return (
    command.includes("patmail") ||
    command.includes("npm run dev") ||
    command.includes("concurrently") ||
    command.includes("tsx watch src/server/index.ts") ||
    command.includes("vite --host 127.0.0.1")
  );
}

export async function describeStatus() {
  const pid = readPid();
  const pidRunning = isPidRunning(pid);
  const listeningPids = await portPids();
  return { pid, pidRunning, listeningPids };
}
