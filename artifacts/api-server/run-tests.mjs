import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const apiServerDir = path.dirname(fileURLToPath(import.meta.url));
// The outer runner owns this directory too, including on SIGINT/SIGTERM.
if (!process.env.API_TEST_OUTPUT_DIR || !process.env.DATABASE_URL) {
  throw new Error("Run pnpm --filter @workspace/api-server test to provision an isolated database.");
}
const tempDir = await mkdtemp(path.join(process.env.API_TEST_OUTPUT_DIR, "bundles-"));
const testBundles = [
  path.join(tempDir, "practice-retention.test.cjs"),
  path.join(tempDir, "practice-maintenance-monitor.test.cjs"),
  path.join(tempDir, "practice-usage.test.cjs"),
  path.join(tempDir, "whop-webhook-signature.test.cjs"),
  path.join(tempDir, "practice-link-recovery.test.cjs"),
  path.join(tempDir, "practice-recovery-whop.test.cjs"),
  path.join(tempDir, "practice-billing.test.cjs"),
];

try {
  await build({
    entryPoints: [
      path.join(apiServerDir, "src/lib/practice-retention.test.ts"),
      path.join(apiServerDir, "src/lib/practice-maintenance-monitor.test.ts"),
      path.join(apiServerDir, "src/lib/practice-usage.test.ts"),
      path.join(apiServerDir, "src/lib/whop-webhook-signature.test.ts"),
      path.join(apiServerDir, "src/lib/practice-link-recovery.test.ts"),
      path.join(apiServerDir, "src/lib/practice-recovery-whop.test.ts"),
      path.join(apiServerDir, "src/lib/practice-billing.test.ts"),
    ],
    bundle: true,
    platform: "node",
    format: "cjs",
    outdir: tempDir,
    outExtension: { ".js": ".cjs" },
    logLevel: "info",
  });

  // Replace external boundaries only in the HTTP test bundle. The real router,
  // account lookup, quota coordinator, and PostgreSQL queries remain intact.
  const routeTestBundle = path.join(tempDir, "practice-route.test.cjs");
  const routeTestBoundaryPlugin = {
    name: "practice-route-test-boundaries",
    setup(build) {
      const fixture = path.join(apiServerDir, "src/test-support/practice-route-boundaries.ts");
      build.onResolve({
        filter: /^(@clerk\/express|@workspace\/integrations-openai-ai-server|\.\.\/lib\/seed)$/,
      }, () => ({ path: fixture }));
    },
  };
  await build({
    entryPoints: [path.join(apiServerDir, "src/routes/practice.test.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: routeTestBundle,
    plugins: [routeTestBoundaryPlugin],
    logLevel: "info",
  });
  testBundles.push(routeTestBundle);

  const browserTestBundle = path.join(tempDir, "practice-browser.test.cjs");
  await build({
    entryPoints: [path.join(apiServerDir, "src/routes/practice-browser.test.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: browserTestBundle,
    external: ["playwright"],
    plugins: [routeTestBoundaryPlugin],
    logLevel: "info",
  });
  const testEnvironment = {
    ...process.env,
    NODE_PATH: [
      path.join(apiServerDir, "node_modules"),
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter),
  };
  const result = spawnSync(
    process.execPath,
    ["--test", ...testBundles],
    { cwd: apiServerDir, env: testEnvironment, stdio: "inherit" },
  );
  if (result.error) throw result.error;

  // Run browser checks after the API suites: their deterministic question
  // fixtures share the isolated database and must not change parallel tests.
  const browserResult = spawnSync(
    process.execPath,
    ["--test", browserTestBundle],
    { cwd: apiServerDir, env: testEnvironment, stdio: "inherit" },
  );
  if (browserResult.error) throw browserResult.error;
  process.exitCode =
    result.status === 0
      ? (browserResult.status ?? 1)
      : (result.status ?? 1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}