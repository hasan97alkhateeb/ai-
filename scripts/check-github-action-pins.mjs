import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

export function inspectWorkflowActions(source, file = "<workflow>") {
  const violations = [];
  let actionReferencesChecked = 0;
  let blockScalarIndentation;

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const indentation = line.match(/^\s*/)?.[0].length ?? 0;

    if (blockScalarIndentation !== undefined) {
      if (!line.trim() || indentation > blockScalarIndentation) continue;
      blockScalarIndentation = undefined;
    }

    const blockScalar = line.match(
      /^(\s*)[^#\s][^:]*:\s*[|>](?:[+-]\d?|\d+[+-]?|)\s*(?:#.*)?$/,
    );
    const usesKey = /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:/.test(line);
    if (usesKey && blockScalar) {
      actionReferencesChecked += 1;
      violations.push(
        `${file}:${index + 1}: action references must be single-line uses values`,
      );
      blockScalarIndentation = blockScalar[1].length;
      continue;
    }

    if (usesKey) {
      actionReferencesChecked += 1;
      const uses = line.match(
        /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))(?:\s+#\s*(.*))?\s*$/,
      );
      if (!uses) {
        violations.push(
          `${file}:${index + 1}: uses must be a single-line owner/repository@<40-character commit SHA> reference`,
        );
        continue;
      }

      const actionReference = uses[1] ?? uses[2] ?? uses[3];
      const versionComment = uses[4] ?? "";
      if (actionReference.startsWith("./")) continue;

      const atIndex = actionReference.lastIndexOf("@");
      const repositoryPath =
        atIndex > 0 ? actionReference.slice(0, atIndex) : "";
      const reference = atIndex > 0 ? actionReference.slice(atIndex + 1) : "";
      const pathParts = repositoryPath.split("/");

      if (
        pathParts.length < 2 ||
        pathParts.some((part) => !part) ||
        !reference ||
        /\s/.test(actionReference)
      ) {
        violations.push(
          `${file}:${index + 1}: external action "${actionReference}" must use owner/repository@<40-character commit SHA>`,
        );
        continue;
      }

      if (!/^[0-9a-f]{40}$/i.test(reference)) {
        violations.push(
          `${file}:${index + 1}: external action "${actionReference}" is not pinned to a full 40-character commit SHA`,
        );
        continue;
      }

      if (!/\bv\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/.test(versionComment)) {
        violations.push(
          `${file}:${index + 1}: add a same-line version comment such as "# v4.4.0"`,
        );
      }
      continue;
    }

    const flowStyleUses =
      /\{\s*(?:[^{}]*?,\s*)?(?:uses|"uses"|'uses')\s*:/.test(line);
    if (flowStyleUses) {
      actionReferencesChecked += 1;
      violations.push(
        `${file}:${index + 1}: place action references on a standalone uses: line so the pin guard can validate them`,
      );
      continue;
    }

    if (blockScalar) {
      blockScalarIndentation = blockScalar[1].length;
    }
  }

  return { actionReferencesChecked, violations };
}

async function findWorkflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findWorkflowFiles(entryPath);
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) return [entryPath];
      return [];
    }),
  );

  return nestedFiles.flat().sort();
}

async function findActionManifestFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findActionManifestFiles(entryPath);
      if (entry.isFile() && /^action\.ya?ml$/i.test(entry.name)) {
        return [entryPath];
      }
      return [];
    }),
  );

  return nestedFiles.flat().sort();
}

export async function inspectRepositoryActions(repositoryRoot) {
  const workflowsDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = await findWorkflowFiles(workflowsDirectory);
  if (workflowFiles.length === 0) {
    throw new Error(`No YAML workflows found in ${workflowsDirectory}`);
  }

  const actionManifestFiles = await findActionManifestFiles(
    path.join(repositoryRoot, ".github", "actions"),
  );
  const filesToInspect = [...workflowFiles, ...actionManifestFiles];
  const violations = [];
  let actionReferencesChecked = 0;
  for (const file of filesToInspect) {
    const source = await readFile(file, "utf8");
    const relativePath = path.relative(repositoryRoot, file);
    const result = inspectWorkflowActions(source, relativePath);
    actionReferencesChecked += result.actionReferencesChecked;
    violations.push(...result.violations);
  }

  return {
    workflowFileCount: workflowFiles.length,
    actionManifestCount: actionManifestFiles.length,
    actionReferencesChecked,
    violations,
  };
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  const {
    workflowFileCount,
    actionManifestCount,
    actionReferencesChecked,
    violations,
  } = await inspectRepositoryActions(repositoryRoot);

  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Checked ${workflowFileCount} workflow file(s), ${actionManifestCount} local action manifest(s), and ${actionReferencesChecked} action reference(s); all external actions use full commit SHAs with version comments.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
