import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

const start = spawnSync(npm, ["run", "dev:start"], {
  cwd: root,
  stdio: "inherit"
});
if (start.status !== 0) process.exit(start.status || 1);

const child = spawn(electronBin, ["."], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PATMAIL_DEV_URL: "http://127.0.0.1:5181"
  }
});

child.on("exit", code => {
  spawnSync(npm, ["run", "dev:stop"], {
    cwd: root,
    stdio: "inherit"
  });
  process.exit(code || 0);
});
