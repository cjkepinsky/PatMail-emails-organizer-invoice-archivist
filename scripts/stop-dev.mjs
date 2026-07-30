import { describeStatus, portPids, processTable, relatedDevPids, removePid } from "./dev-utils.mjs";

const status = await describeStatus();
const targets = new Set(status.listeningPids);
if (status.pid) targets.add(status.pid);

if (targets.size > 0) {
  const table = await processTable();
  for (const pid of relatedDevPids(table, [...targets])) targets.add(pid);
}

if (targets.size === 0) {
  console.log("No PatMail dev processes found.");
  removePid();
  process.exit(0);
}

for (const pid of targets) {
  stopPid(pid, "SIGTERM");
}

await wait(800);

const remaining = await portPids();
if (remaining.length > 0) {
  const table = await processTable();
  const remainingTargets = relatedDevPids(table, remaining);
  for (const pid of remainingTargets) stopPid(pid, "SIGKILL");
}

removePid();
console.log("PatMail dev server stopped.");

function stopPid(pid, signal = "SIGTERM") {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
