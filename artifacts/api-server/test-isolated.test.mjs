import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("./test-isolated.sh", import.meta.url));

for (const scenario of [
  { name: "schema failure", pnpm: "exit 47", expected: 47 },
  { name: "test failure", pnpm: "exit 0", node: "exit 48", expected: 48 },
  { name: "SIGTERM", pnpm: 'echo READY; exec sleep 60', signal: "SIGTERM", expected: 143 },
  { name: "SIGINT", pnpm: 'echo READY; exec sleep 60', signal: "SIGINT", expected: 130 },
]) {
  test(`isolated database is removed after ${scenario.name}`, { timeout: 30_000 }, async () => {
    const bin = await mkdtemp(path.join(os.tmpdir(), "api-runner-check-"));
    let child;
    try {
      // Real initdb/pg_ctl, but controllable schema/test subprocesses.
      for (const [name, body] of [["pnpm", scenario.pnpm], ["node", scenario.node ?? "exit 0"]]) {
        await writeFile(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o700 });
      }
      child = spawn("bash", [runner], {
        env: { PATH: `${bin}:${process.env.PATH}`, DATABASE_URL: "must-not-be-used" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let signaled = false;
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (scenario.signal && !signaled && output.includes("READY")) {
          signaled = true;
          child.kill(scenario.signal);
        }
      });
      child.stderr.on("data", (chunk) => { output += chunk; });
      const status = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assert.equal(status, scenario.expected, output);
      const directory = output.match(/Using disposable API test database: (\/tmp\/api-tests\.\w+)/)?.[1];
      assert.ok(directory, output);
      assert.match(output, /server stopped/, output);
      await assert.rejects(access(directory), { code: "ENOENT" });
    } finally {
      if (child && child.exitCode === null) child.kill("SIGTERM");
      await rm(bin, { recursive: true, force: true });
    }
  });
}