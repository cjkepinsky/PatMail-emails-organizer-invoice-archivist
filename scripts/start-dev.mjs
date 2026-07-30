import fs from "node:fs";
import { spawn } from "node:child_process";
import { describeStatus, ensureLocalDir, logFile, writePid } from "./dev-utils.mjs";

const status = await describeStatus();
if (status.pidRunning || status.listeningPids.length > 0) {
  console.log("PatMail dev server already appears to be running.");
  if (status.pid) console.log(`PID file: ${status.pid}`);
  if (status.listeningPids.length > 0) console.log(`Listening PIDs: ${status.listeningPids.join(", ")}`);
  process.exit(0);
}

ensureLocalDir();
const log = fs.openSync(logFile, "a");
const child = spawn("npm", ["run", "dev"], {
  cwd: process.cwd(),
  detached: true,
  stdio: ["ignore", log, log]
});

writePid(child.pid);
child.unref();

console.log(`Started PatMail dev server in the background.`);
console.log(`PID: ${child.pid}`);
console.log(`Log: ${logFile}`);
console.log(`App: http://127.0.0.1:5181`);
