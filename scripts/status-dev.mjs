import { describeStatus, logFile } from "./dev-utils.mjs";

const status = await describeStatus();

if (!status.pidRunning && status.listeningPids.length === 0) {
  console.log("PatMail dev server is not running.");
  process.exit(0);
}

console.log("PatMail dev server appears to be running.");
if (status.pid) console.log(`PID file: ${status.pid} (${status.pidRunning ? "running" : "stale"})`);
if (status.listeningPids.length > 0) console.log(`Listening PIDs: ${status.listeningPids.join(", ")}`);
console.log("App: http://127.0.0.1:5181");
console.log(`Log: ${logFile}`);
