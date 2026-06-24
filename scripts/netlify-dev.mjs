/**
 * Fast local `netlify dev` for projects that don't use Netlify Database.
 *
 * Netlify CLI 26+ boots PGlite on every dev start. This app uses Blobs + data/*.json
 * only; stale `.netlify/db` state (common on Windows) can hang startup for minutes.
 * `--offline` skips Netlify API round-trips; use plain `netlify dev` if you need UI env vars.
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = path.join(root, ".netlify", "db");

try {
  await rm(dbDir, { recursive: true, force: true });
} catch {
  // ignore — dev can still proceed if cleanup fails
}

const offline = !process.argv.slice(2).includes("--online");
const passthrough = process.argv.slice(2).filter((a) => a !== "--online");
const args = ["dev", ...(offline ? ["--offline"] : []), ...passthrough];

function spawnNetlify(cliArgs) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "netlify", ...cliArgs], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
  }
  return spawn("netlify", cliArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

const child = spawnNetlify(args);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
