import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTempDir, cleanupTempDir } from "./helpers/temp-db.js";
import { resolveTsxCommand } from "./helpers/tsx-path.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = resolveTsxCommand(repoRoot);

test("config init local prints a usable starter entry", async () => {
  const tempDir = await createTempDir("openclaw-recall-config-");
  try {
    const output = runCli(["config", "init", "--mode", "local", "--json"], tempDir);
    assert.equal(output.plugins.entries["openclaw-recall"].config.identity.mode, "local");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("config init reconnect prints reconnect identity fields", async () => {
  const tempDir = await createTempDir("openclaw-recall-config-");
  try {
    const output = runCli(
      [
        "config",
        "init",
        "--mode",
        "reconnect",
        "--identity-key",
        "recall_test_identity",
        "--memory-space",
        "space_test_1",
        "--json",
      ],
      tempDir,
    );
    const identity = output.plugins.entries["openclaw-recall"].config.identity;
    assert.equal(identity.mode, "reconnect");
    assert.equal(identity.identityKey, "recall_test_identity");
    assert.equal(identity.memorySpaceId, "space_test_1");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("config validate catches invalid reconnect identity", async () => {
  const tempDir = await createTempDir("openclaw-recall-config-");
  try {
    await writeOpenClawConfig(tempDir, {
      plugins: {
        entries: {
          "openclaw-recall": {
            enabled: true,
            config: {
              identity: {
                mode: "reconnect",
              },
            },
          },
        },
      },
    });
    const output = runCli(["config", "validate", "--json"], tempDir);
    assert.equal(output.valid, false);
    assert.ok(output.issues.some((issue: { field: string }) => issue.field === "identity.mode"));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("config show includes resolved identity mode", async () => {
  const tempDir = await createTempDir("openclaw-recall-config-");
  try {
    runCli(
      [
        "config",
        "init",
        "--mode",
        "reconnect",
        "--identity-key",
        "recall_test_identity",
        "--write-openclaw",
        "--json",
      ],
      tempDir,
    );
    const output = runCli(["config", "show", "--json"], tempDir);
    assert.equal(output.identityMode, "reconnect");
    assert.equal(output.resolved.identity.identityKey, "recall_test_identity");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

function runCli(args: string[], openclawRoot: string): any {
  return JSON.parse(
    execFileSync(tsx.command, [...tsx.argsPrefix, "src/cli/index.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_HOME: openclawRoot,
      },
    }),
  );
}

async function writeOpenClawConfig(openclawRoot: string, value: Record<string, unknown>): Promise<void> {
  const configDir = path.join(openclawRoot, ".openclaw");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "openclaw.json"), JSON.stringify(value, null, 2));
}
