import { spawnSync } from "node:child_process";
import path from "node:path";

export default async function adHocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Ad-hoc signing failed for ${appPath}`);
  }
}
