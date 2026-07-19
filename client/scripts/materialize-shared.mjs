import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(scriptDir, "..");
const sourceDir = resolve(clientDir, "../shared");
const targetDir = resolve(clientDir, "node_modules/@rybbit/shared");

try {
  await lstat(targetDir);
  await rm(targetDir, { recursive: true, force: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(targetDir, { recursive: true });
await cp(resolve(sourceDir, "package.json"), resolve(targetDir, "package.json"));
await cp(resolve(sourceDir, "dist"), resolve(targetDir, "dist"), { recursive: true });

console.log("Materialized @rybbit/shared inside the client workspace");
