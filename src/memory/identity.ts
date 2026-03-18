import type { MemoryRecord } from "../types/domain.js";
import { fingerprint } from "../shared/text.js";

type FingerprintInput = Pick<MemoryRecord, "kind" | "summary" | "memoryGroup">;
type EmbeddingTextInput = Pick<MemoryRecord, "summary" | "content">;

export function buildMemoryFingerprint(memory: FingerprintInput): string {
  return fingerprint([
    memory.kind,
    memory.memoryGroup ?? "",
    memory.summary.trim().toLowerCase(),
  ].join("|"));
}

export function buildMemoryEmbeddingText(memory: EmbeddingTextInput): string {
  return [memory.summary.trim(), memory.content.trim()]
    .filter(Boolean)
    .join("\n");
}
