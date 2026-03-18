import crypto from "node:crypto";

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function tokenize(text: string): string[] {
  const tokens = new Set<string>();
  const parts = text
    .toLowerCase()
    .replace(/[_/\\-]+/g, " ")
    .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu) ?? [];

  for (const part of parts) {
    if (isCjkSequence(part)) {
      for (const token of cjkNgrams(part)) {
        tokens.add(token);
      }
      continue;
    }
    if (part.length >= 2) {
      tokens.add(part);
    }
  }

  return Array.from(tokens);
}

export function fingerprint(value: string): string {
  return crypto
    .createHash("sha1")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

export function truncateToTokens(text: string, maxTokens: number): { text: string; trimmed: boolean } {
  if (estimateTokens(text) <= maxTokens) {
    return { text, trimmed: false };
  }

  const approxChars = Math.max(24, maxTokens * 4);
  const slice = `${text.slice(0, approxChars).trimEnd()}…`;
  return { text: slice, trimmed: true };
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function sentenceFromText(text: string, maxLength = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trimEnd()}…`;
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function isCjkSequence(value: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(value);
}

function cjkNgrams(value: string): string[] {
  const chars = Array.from(value);
  if (chars.length <= 2) {
    return [value];
  }
  const grams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.push(chars.slice(index, index + 2).join(""));
  }
  if (chars.length <= 4) {
    grams.push(value);
  }
  return grams;
}
