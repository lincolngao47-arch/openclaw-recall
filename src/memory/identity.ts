import type { MemoryRecord } from "../types/domain.js";
import { fingerprint } from "../shared/text.js";

type FingerprintInput = Pick<MemoryRecord, "kind" | "summary" | "memoryGroup"> & {
  content?: string;
};
type EmbeddingTextInput = Pick<MemoryRecord, "summary" | "content">;

export function buildMemoryFingerprint(memory: FingerprintInput): string {
  const normalizedSummary = memory.summary.trim().toLowerCase();
  const normalizedContent = (memory.content ?? "").trim().toLowerCase();
  return fingerprint([
    memory.kind,
    memory.memoryGroup ?? "",
    normalizedSummary,
    normalizedContent,
  ].join("|"));
}

export function buildMemoryEmbeddingText(memory: EmbeddingTextInput): string {
  return [memory.summary.trim(), memory.content.trim()]
    .filter(Boolean)
    .join("\n");
}
