import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  inspectRepositoryActions,
  inspectWorkflowActions,
} from "./check-github-action-pins.mjs";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

async function withFixtureRepository(files, run) {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), "action-pin-guard-"),
  );
  try {
    const workflowPath = path.join(
      repositoryRoot,
      ".github",
      "workflows",
      "ci.yml",
    );
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, "name: fixture\n");

    for (const [relativePath, source] of Object.entries(files)) {
      const filePath = path.join(repositoryRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, source);
    }

    return await run(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

const acceptedCompositeActionManifest = `
name: Accepted local composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@${commitSha} # v4.4.0
    - uses: ./.github/actions/local-check
`;

const rejectedCompositeActionManifest = `
name: Rejected local composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@v4 # v4.4.0
    - uses: example/action@${commitSha.slice(0, 39)} # v1.2.3
    - uses: vendor/action@${commitSha}
`;

test("accepts full SHA pins with version comments and local actions", () => {
  const workflow = `
jobs:
  checks:
    uses: example/project/.github/workflows/reusable.yml@${commitSha} # v2.1.0
    steps:
      - uses: actions/checkout@${commitSha} # v4.4.0
      - uses: ./actions/local-check
      - run: |
          uses: third-party/action@mutable-tag
`;

  const result = inspectWorkflowActions(workflow, "ci.yml");
  assert.deepEqual(result.violations, []);
  assert.equal(result.actionReferencesChecked, 3);
});

test("rejects mutable references, short SHAs, and missing version comments", () => {
  const workflow = `
steps:
  - uses: actions/checkout@v4 # v4.4.0
  - uses: example/action@0123456789abcdef0123456789abcdef0123456 # v1.2.3
  - uses: example/action@${commitSha}
`;

  const { violations } = inspectWorkflowActions(workflow, "ci.yml");
  assert.equal(violations.length, 3);
  assert.match(violations[0], /full 40-character commit SHA/);
  assert.match(violations[1], /full 40-character commit SHA/);
  assert.match(violations[2], /same-line version comment/);
});

test("rejects external references that are not owner/repository actions", () => {
  const { violations } = inspectWorkflowActions(
    "steps:\n  - uses: docker://example/image:latest\n",
    "ci.yml",
  );

  assert.equal(violations.length, 1);
  assert.ok(
    violations[0].includes("owner/repository@<40-character commit SHA>"),
  );
});

test("rejects multiline uses values rather than ignoring their contents", () => {
  const { actionReferencesChecked, violations } = inspectWorkflowActions(
    "steps:\n  - uses: |\n      actions/checkout@v4\n",
    "ci.yml",
  );

  assert.equal(actionReferencesChecked, 1);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /single-line uses values/);
});

test("rejects flow-style action references that the guard cannot validate", () => {
  const { actionReferencesChecked, violations } = inspectWorkflowActions(
    "steps: [{ name: Checkout, uses: actions/checkout@v4 }]\n",
    "ci.yml",
  );

  assert.equal(actionReferencesChecked, 1);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /standalone uses: line/);
});

test("scans nested composite manifests and accepts pinned and local references", async () => {
  await withFixtureRepository(
    {
      ".github/actions/nested/example/action.yml":
        acceptedCompositeActionManifest,
    },
    async (repositoryRoot) => {
      const result = await inspectRepositoryActions(repositoryRoot);
      assert.equal(result.workflowFileCount, 1);
      assert.equal(result.actionManifestCount, 1);
      assert.equal(result.actionReferencesChecked, 2);
      assert.deepEqual(result.violations, []);
    },
  );
});

test("rejects unpinned composite-manifest references", async () => {
  await withFixtureRepository(
    {
      ".github/actions/example/action.yaml":
        rejectedCompositeActionManifest,
    },
    async (repositoryRoot) => {
      const result = await inspectRepositoryActions(repositoryRoot);
      assert.equal(result.actionManifestCount, 1);
      assert.equal(result.actionReferencesChecked, 3);
      assert.equal(result.violations.length, 3);
      assert.ok(
        result.violations.every(violation =>
          violation.includes(".github/actions/example/action.yaml"),
        ),
      );
      assert.match(result.violations[0], /full 40-character commit SHA/);
      assert.match(result.violations[1], /full 40-character commit SHA/);
      assert.match(result.violations[2], /same-line version comment/);
    },
  );
});

test("scans workflows when the repository has no local action directory", async () => {
  await withFixtureRepository({}, async (repositoryRoot) => {
    const result = await inspectRepositoryActions(repositoryRoot);
    assert.equal(result.actionManifestCount, 0);
    assert.deepEqual(result.violations, []);
  });
});
