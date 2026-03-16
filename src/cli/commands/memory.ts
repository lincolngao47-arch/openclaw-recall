import { Command } from "commander";
import crypto from "node:crypto";
import { explainSuppression } from "../../memory/MemoryRanker.js";
import { resolvePluginPaths } from "../../storage/paths.js";
import { writeJsonFile } from "../../shared/fileStore.js";
import type { MaintenanceReport, PruneReport } from "../../types/domain.js";
import { addJsonFlag, createCliContainer, printOutput } from "../shared.js";

export function registerMemoryCommands(program: Command): void {
  const memory = addJsonFlag(program.command("memory").description("Inspect plugin-managed memory"));

  addJsonFlag(
    memory
      .command("list")
      .option("--limit <n>", "Maximum records", "25")
      .action(async function action() {
        const { container } = await createCliContainer();
        const records = (await container.memoryStore.listActive()).slice(0, Number(this.opts().limit));
        printOutput(this, records);
      }),
  );

  addJsonFlag(
    memory
      .command("inspect")
      .argument("<id>", "Memory id")
      .action(async function action(id: string) {
        const { container } = await createCliContainer();
        const memory = await container.memoryStore.getById(id);
        printOutput(
          this,
          memory
            ? {
                ...memory,
                suppressedReasons: explainSuppression(memory),
              }
            : null,
        );
      }),
  );

  addJsonFlag(
    memory
      .command("search")
      .argument("<query>", "Search query")
      .option("--session <id>", "Optional session id")
      .option("--limit <n>", "Maximum records", "8")
      .action(async function action(query: string) {
        const { container } = await createCliContainer();
        const result = await container.memoryRetriever.retrieveWithContext(query, Number(this.opts().limit), {
          sessionId: this.opts().session,
        });
        printOutput(this, result);
      }),
  );

  addJsonFlag(
    memory
      .command("explain")
      .argument("<query>", "Query to explain")
      .option("--session <id>", "Optional session id")
      .option("--limit <n>", "Maximum records", "8")
      .action(async function action(query: string) {
        const { container } = await createCliContainer();
        const result = await container.memoryRetriever.explainDetailed(query, Number(this.opts().limit), {
          sessionId: this.opts().session,
        });
        printOutput(this, result);
      }),
  );

  addJsonFlag(
    memory
      .command("prune-noise")
      .description("Deactivate noisy or internal memories that should not be recalled")
      .option("--dry-run", "Preview which memories would be pruned without changing stored data")
      .action(async function action() {
        const { container } = await createCliContainer();
        const result = await container.memoryStore.pruneNoise({ dryRun: this.opts().dryRun === true });
        const report: PruneReport = {
          pruneId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          dryRun: result.dryRun,
          scanned: result.scanned,
          pruned: result.pruned,
          ids: result.ids,
          notes: result.dryRun
            ? ["Dry-run only; no stored memories were modified."]
            : ["Suppressed/noisy memories were deactivated rather than deleted."],
        };
        await writeJsonFile(resolvePluginPaths().latestPrunePath, report);
        printOutput(this, report);
      }),
  );

  addJsonFlag(
    memory
      .command("reindex")
      .description("Recompute fingerprints, default scopes, and suppression metadata without changing user text")
      .option("--dry-run", "Preview changes without mutating stored data")
      .action(async function action() {
        const { container, pluginPaths } = await createCliContainer();
        const result = await container.memoryStore.reindex({ dryRun: this.opts().dryRun === true });
        const report: MaintenanceReport = {
          operation: "reindex",
          reportId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          dryRun: this.opts().dryRun === true,
          scanned: result.scanned,
          changed: result.changed,
          ids: result.ids,
          hygieneScore: result.hygiene.score,
          notes: result.dryRun
            ? ["Dry-run only; no stored memories were mutated."]
            : ["Fingerprints, scope defaults, and suppression metadata were refreshed."],
        };
        await writeJsonFile(pluginPaths.latestReindexPath, report);
        printOutput(this, report);
      }),
  );

  addJsonFlag(
    memory
      .command("compact")
      .description("Compact inactive, superseded, or expired memories without deleting inspectable history")
      .option("--dry-run", "Preview compaction changes without mutating stored data")
      .action(async function action() {
        const { container, pluginPaths } = await createCliContainer();
        const result = await container.memoryStore.compact({ dryRun: this.opts().dryRun === true });
        const report: MaintenanceReport = {
          operation: "compact",
          reportId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          dryRun: this.opts().dryRun === true,
          scanned: result.scanned,
          changed: result.compacted,
          ids: result.ids,
          hygieneScore: result.hygiene.score,
          notes: result.dryRun
            ? ["Dry-run only; no memory rows were compacted."]
            : ["Inactive, superseded, or expired memories were compacted in place for long-term hygiene."],
        };
        await writeJsonFile(pluginPaths.latestCompactPath, report);
        printOutput(this, report);
      }),
  );
}
