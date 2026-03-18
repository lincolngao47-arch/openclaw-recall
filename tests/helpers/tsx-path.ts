import { existsSync } from "node:fs";
import path from "node:path";

export function resolveTsxCommand(repoRoot: string): {
  command: string;
  argsPrefix: string[];
} {
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  if (existsSync(tsxBin)) {
    return {
      command: tsxBin,
      argsPrefix: [],
    };
  }
  return {
    command: process.execPath,
    argsPrefix: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs")],
  };
}
