import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ports = ["8797", "5181"];

try {
  const { stdout } = await execFileAsync("lsof", ["-ti", ...ports.flatMap(port => ["tcp:" + port])]);
  const pids = stdout
    .split(/\s+/)
    .map(value => Number(value))
    .filter(Boolean);

  if (pids.length === 0) {
    console.log("No Invoice Archivist dev processes found.");
    process.exit(0);
  }

  for (const pid of new Set(pids)) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopped process ${pid}.`);
    } catch (error) {
      console.warn(`Could not stop process ${pid}: ${error.message}`);
    }
  }
} catch (error) {
  if (error.code === 1) {
    console.log("No Invoice Archivist dev processes found.");
    process.exit(0);
  }
  console.error(error.message);
  process.exit(1);
}
