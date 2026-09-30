// Local privileged operator tool, deliberately not reachable over HTTP.
import { userInfo } from "node:os";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const [command, conflictId, ...args] = process.argv.slice(2);
if (!["inspect", "verify", "approve"].includes(command) || !conflictId) {
  throw new Error("Usage: node recover-practice-link.mjs inspect CASE | verify CASE EVIDENCE.json | approve CASE CANONICAL_LEARNER RETAINED_MEMBERSHIP");
}
// The username comes from the OS, not a caller-supplied --operator flag.
// Shared service users require a separately authenticated session reference.
const operatorSession = process.env.PRACTICE_SUPPORT_SESSION?.trim();
if (!operatorSession || operatorSession.length < 8) throw new Error("PRACTICE_SUPPORT_SESSION must identify your authenticated privileged access session.");
const operator = `${userInfo().username}:${operatorSession}`;
const temp = await mkdtemp(path.join(tmpdir(), "practice-recovery-"));
let pool;
try {
  const outfile = path.join(temp, "recovery.mjs");
  await build({
    stdin: {
      contents: 'export * from "./src/lib/practice-link-recovery"; export { pool } from "@workspace/db";',
      resolveDir: path.dirname(new URL(import.meta.url).pathname),
    },
    outfile, bundle: true, platform: "node", format: "esm",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const api = await import(pathToFileURL(outfile).href);
  pool = api.pool;
  if (command === "inspect") {
    if (args.length) throw new Error("Unexpected arguments.");
    console.log(JSON.stringify(await api.inspectPracticeConflict(conflictId, operator), null, 2));
  } else if (command === "verify") {
    if (args.length !== 1) throw new Error("Provide one evidence file.");
    const info = await stat(args[0]);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== userInfo().uid) throw new Error("Evidence must be an operator-owned regular file with mode 0600.");
    await api.recordPracticeConflictEvidence(conflictId, operator, JSON.parse(await readFile(args[0], "utf8")));
    console.log("Manual evidence recorded and live Whop checks passed. Approval will recheck Whop. No usage or memberships changed.");
  } else {
    if (args.length !== 2) throw new Error("Explicitly supply canonical learner and retained membership IDs.");
    console.log(JSON.stringify(await api.resolvePracticeConflict(conflictId, operator, args[0], args[1]), null, 2));
  }
} finally {
  if (pool) await pool.end();
  await rm(temp, { recursive: true, force: true });
}