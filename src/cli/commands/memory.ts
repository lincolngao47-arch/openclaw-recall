import { Command } from "commander";
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
        printOutput(this, await container.memoryStore.getById(id));
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
        const result = await container.memoryRetriever.retrieve(query, Number(this.opts().limit), {
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
        const result = await container.memoryRetriever.explain(query, Number(this.opts().limit), {
          sessionId: this.opts().session,
        });
        printOutput(this, result);
      }),
  );

  addJsonFlag(
    memory
      .command("prune-noise")
      .description("Deactivate noisy or internal memories that should not be recalled")
      .action(async function action() {
        const { container } = await createCliContainer();
        printOutput(this, await container.memoryStore.pruneNoise());
      }),
  );
}
