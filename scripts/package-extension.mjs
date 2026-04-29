import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const releaseDir = resolve(root, "release");
const zipName = `${packageJson.name}-v${packageJson.version}.zip`;
const zipPath = resolve(releaseDir, zipName);

await mkdir(releaseDir, { recursive: true });
await rm(zipPath, { force: true });

const result = spawnSync("zip", ["-qr", zipPath, "."], {
  cwd: resolve(root, "dist"),
  stdio: "inherit",
});

if (result.status !== 0) {
  throw new Error(`zip failed with status ${result.status ?? "unknown"}`);
}

console.log(zipPath);
