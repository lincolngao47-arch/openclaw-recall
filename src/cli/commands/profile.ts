import { Command } from "commander";
import { addJsonFlag, createCliContainer, printOutput } from "../shared.js";

export function registerProfileCommands(program: Command): void {
  const profile = addJsonFlag(program.command("profile").description("Inspect recorded prompt profiles"));

  addJsonFlag(
    profile
      .command("list")
      .option("--session <id>", "Optional session id")
      .option("--limit <n>", "Maximum records", "20")
      .action(async function action() {
        const { container } = await createCliContainer();
        printOutput(
          this,
          await container.profileStore.list(Number(this.opts().limit), {
            sessionId: this.opts().session,
          }),
        );
      }),
  );

  addJsonFlag(
    profile
      .command("inspect")
      .argument("<runId>", "Run id")
      .action(async function action(runId: string) {
        const { container } = await createCliContainer();
        const profile = await container.profileStore.get(runId);
        printOutput(
          this,
          profile
            ? {
                ...profile,
                summary: {
                  prompt: `${profile.promptTokens} (${profile.promptTokensSource})`,
                  retrieval: {
                    mode: profile.retrievalMode,
                    count: profile.retrievalCount,
                    keywordContribution: profile.keywordContribution,
                    semanticContribution: profile.semanticContribution,
                  },
                  memory: {
                    injected: profile.memoryInjected,
                    candidates: profile.memoryCandidates,
                    written: profile.memoryWritten,
                    retrievals: profile.retrievalCount,
                  },
                  toolCompaction: `${profile.toolTokensSaved} (${profile.toolTokensSavedSource})`,
                  compression: `${profile.compressionSavings} (${profile.compressionSavingsSource})`,
                },
              }
            : null,
        );
      }),
  );
}
