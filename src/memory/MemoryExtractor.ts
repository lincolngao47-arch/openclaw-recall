import crypto from "node:crypto";
import { fingerprint, sentenceFromText, tokenize, uniqueStrings } from "../shared/text.js";
import {
  hasStablePreferenceSignal,
  isLowValueEmotionalText,
  isNoiseLikeText,
  sanitizeIncomingUserText,
  shouldRejectMemoryCandidate,
} from "../shared/safety.js";
import { ChatTurn, MemoryKind, MemoryRecord, SessionState } from "../types/domain.js";
import { buildMemoryFingerprint } from "./identity.js";

export interface ExtractionResult {
  memories: MemoryRecord[];
  statePatch: Partial<Omit<SessionState, "sessionId" | "updatedAt">>;
  candidateCount: number;
}

type CandidateSeed = {
  kind: MemoryKind;
  summary: string;
  content: string;
  ttlDays?: number;
  decayRate?: number;
  futureUtility: number;
  userSpecificity: number;
  repetition: number;
  semanticWeight: number;
  redundancy: number;
  confidence: number;
  memoryGroup?: string;
};

export interface MemoryExtractorPolicy {
  writeThreshold: number;
  preferenceTtlDays: number;
  semanticTtlDays: number;
  episodicTtlDays: number;
  sessionStateTtlDays: number;
}

export class MemoryExtractor {
  constructor(private readonly policy: MemoryExtractorPolicy) {}

  extract(turn: ChatTurn): ExtractionResult {
    const text = sanitizeIncomingUserText(turn.text);
    if (!text || isNoiseLikeText(text) || isLowValueEmotionalText(text)) {
      return {
        memories: [],
        statePatch: { constraints: [], decisions: [], openQuestions: [] },
        candidateCount: 0,
      };
    }
    const topics = tokenize(text);
    const entityKeys = extractEntityKeys(text);
    const now = new Date().toISOString();
    const isQuestion = /[?？]/.test(text);
    const isRecallQuery = /记得|remember|memory|回忆|还记得/i.test(text);
    const preferenceRequest = hasPreferenceRequestSignal(text);
    const assistantPreferenceSummary = turn.role === "assistant" && hasStablePreferenceSignal(text);
    const candidates: CandidateSeed[] = [];
    const statePatch: ExtractionResult["statePatch"] = {
      constraints: [],
      decisions: [],
      openQuestions: [],
    };

    if (!isRecallQuery && (!isQuestion || preferenceRequest)) {
      candidates.push(...extractPreferenceCandidates(text));
    }
    if (!isQuestion && !isRecallQuery) {
      if (turn.role !== "assistant") {
        candidates.push(...extractSemanticCandidates(text));
        candidates.push(...extractEpisodicCandidates(text));
      }
    }

    const taskMatch = text.match(/(?:当前任务[:：]?\s*|task[:：]?\s*|目标是[:：]?\s*|需要[:：]?\s*|need to[:：]?\s*|next step[:：]?\s*|下一步[:：]?\s*|pending[:：]?\s*|要做[:：]?\s*)(.+)/i);
    if (turn.role !== "assistant" && taskMatch && !isQuestion && !hasStablePreferenceSignal(text)) {
      statePatch.currentTask = sentenceFromText(taskMatch[1]);
      candidates.push({
        kind: "session_state",
        summary: `Current task: ${sentenceFromText(taskMatch[1])}.`,
        content: text,
        ttlDays: this.policy.sessionStateTtlDays,
        decayRate: 0.18,
        futureUtility: 3.2,
        userSpecificity: 2.2,
        repetition: 0.8,
        semanticWeight: 1.6,
        redundancy: 0.3,
        confidence: 0.82,
        memoryGroup: "session:current-task",
      });
    }

    if (turn.role !== "assistant" && !isQuestion && /不要|不能|must not|must|constraint|约束/i.test(text)) {
      const constraint = sentenceFromText(text);
      statePatch.constraints = uniqueStrings([constraint]);
      candidates.push({
        kind: "session_state",
        summary: `Constraint: ${constraint}.`,
        content: text,
        ttlDays: this.policy.sessionStateTtlDays,
        decayRate: 0.12,
        futureUtility: 3.1,
        userSpecificity: 1.8,
        repetition: 0.6,
        semanticWeight: 1.4,
        redundancy: 0.2,
        confidence: 0.8,
        memoryGroup: `constraint:${fingerprint(constraint)}`,
      });
    }

    if (turn.role !== "assistant" && !isQuestion && /决定|decide|will use|采用|选择|we should|我们要/i.test(text)) {
      const decision = sentenceFromText(text);
      statePatch.decisions = uniqueStrings([decision]);
      candidates.push({
        kind: "session_state",
        summary: `Decision: ${decision}.`,
        content: text,
        ttlDays: this.policy.sessionStateTtlDays,
        decayRate: 0.12,
        futureUtility: 3.0,
        userSpecificity: 1.7,
        repetition: 0.9,
        semanticWeight: 1.5,
        redundancy: 0.2,
        confidence: 0.82,
        memoryGroup: `decision:${fingerprint(decision)}`,
      });
    }

    if (turn.role === "user" && isQuestion && !preferenceRequest) {
      const question = sentenceFromText(text);
      statePatch.openQuestions = uniqueStrings([question]);
      candidates.push({
        kind: "session_state",
        summary: `Open question: ${question}.`,
        content: text,
        ttlDays: this.policy.sessionStateTtlDays,
        decayRate: 0.24,
        futureUtility: 2.1,
        userSpecificity: 1.4,
        repetition: 0.2,
        semanticWeight: 1.1,
        redundancy: 0.1,
        confidence: 0.7,
        memoryGroup: `open-question:${fingerprint(question)}`,
      });
    }

    if (assistantPreferenceSummary && candidates.length === 0) {
      candidates.push(
        ...extractPreferenceCandidates(text),
      );
    }

    const memories = candidates
      .map((candidate) => this.materializeCandidate(candidate, { ...turn, text }, topics, entityKeys, now))
      .filter((memory) => !shouldRejectMemoryCandidate(turn, memory))
      .filter((memory) => (memory.importance ?? 0) >= this.policy.writeThreshold)
      .filter(uniqueByFingerprint);

    return {
      memories,
      statePatch,
      candidateCount: candidates.length,
    };
  }

  limit(memories: MemoryRecord[], maxWrites: number): MemoryRecord[] {
    return [...memories]
      .sort((left, right) => (right.importance ?? 0) - (left.importance ?? 0))
      .slice(0, maxWrites);
  }

  private materializeCandidate(
    candidate: CandidateSeed,
    turn: ChatTurn,
    topics: string[],
    entityKeys: string[],
    now: string,
  ): MemoryRecord {
    const normalizedSummary = candidate.summary.trim();
    const importance =
      candidate.futureUtility +
      candidate.userSpecificity +
      candidate.repetition +
      candidate.semanticWeight -
      candidate.redundancy;
    return {
      id: crypto.randomUUID(),
      kind: candidate.kind,
      summary: normalizedSummary,
      content: candidate.content,
      topics,
      entityKeys,
      salience: Math.min(10, 4 + importance),
      fingerprint: buildMemoryFingerprint({
        kind: candidate.kind,
        summary: normalizedSummary,
        content: candidate.content,
        memoryGroup: candidate.memoryGroup,
      }),
      createdAt: now,
      lastSeenAt: now,
      ttlDays: candidate.ttlDays ?? this.defaultTtlFor(candidate.kind),
      decayRate: candidate.decayRate ?? 0.06,
      confidence: candidate.confidence,
      importance,
      active: true,
      memoryGroup: candidate.memoryGroup,
      version: 1,
      sourceSessionId: turn.sessionId,
      sourceTurnIds: [turn.id],
    };
  }

  private defaultTtlFor(kind: MemoryKind): number {
    if (kind === "preference") {
      return this.policy.preferenceTtlDays;
    }
    if (kind === "semantic") {
      return this.policy.semanticTtlDays;
    }
    if (kind === "session_state") {
      return this.policy.sessionStateTtlDays;
    }
    return this.policy.episodicTtlDays;
  }
}

function uniqueByFingerprint(
  memory: MemoryRecord,
  index: number,
  records: MemoryRecord[],
): boolean {
  return records.findIndex((candidate) => candidate.fingerprint === memory.fingerprint) === index;
}

function extractPreferenceCandidates(text: string): CandidateSeed[] {
  const patterns: Array<{
    regex: RegExp;
    summary: (match: RegExpMatchArray) => string;
    group: string;
    futureUtility?: number;
    userSpecificity?: number;
    repetition?: number;
    semanticWeight?: number;
    redundancy?: number;
    confidence?: number;
  }> = [
    {
      regex: /以后默认叫我(.+)/,
      summary: (match) => `User prefers to be addressed as ${sentenceFromText(match[1], 40)}.`,
      group: "preference:name",
    },
    {
      regex: /叫我(.+)/,
      summary: (match) => `User prefers to be addressed as ${sentenceFromText(match[1], 40)}.`,
      group: "preference:name",
    },
    {
      regex: /call me (.+)/i,
      summary: (match) => `User prefers to be addressed as ${sentenceFromText(match[1], 40)}.`,
      group: "preference:name",
    },
    {
      regex: /i prefer (.+)/i,
      summary: (match) => `User prefers ${sentenceFromText(match[1])}.`,
      group: "preference:style",
    },
    {
      regex: /i like (.+)/i,
      summary: (match) => `User likes ${sentenceFromText(match[1])}.`,
      group: "preference:style",
    },
    {
      regex: /我喜欢(.+)/,
      summary: (match) => `User likes ${sentenceFromText(match[1])}.`,
      group: "preference:style",
    },
    {
      regex: /prefer chinese|use chinese|answer in chinese|reply in chinese|respond in chinese|中文回答|用中文/i,
      summary: () => "User prefers Chinese responses.",
      group: "preference:language",
      futureUtility: 3.8,
      userSpecificity: 3.2,
      semanticWeight: 2.5,
      confidence: 0.94,
    },
    {
      regex: /concise|简洁|简短|精简|直接|terminal-first/i,
      summary: () => "User prefers concise terminal-first answers.",
      group: "preference:style",
      futureUtility: 3.7,
      userSpecificity: 3.1,
      repetition: 1.1,
      semanticWeight: 2.4,
      confidence: 0.93,
    },
    {
      regex: /直接给结果|执行导向|可执行|短.?准.?可执行|先给结论|先说结论/i,
      summary: () => "User prefers direct, execution-oriented answers.",
      group: "preference:style",
      futureUtility: 3.9,
      userSpecificity: 3.2,
      repetition: 1.0,
      semanticWeight: 2.4,
      confidence: 0.94,
    },
    {
      regex: /结构化输出|结构化汇报|结论.{0,8}进度.{0,8}风险.{0,8}下一步|已完成.{0,8}未完成.{0,8}下一步/i,
      summary: () => "User prefers structured updates with conclusion, progress, risk, and next steps.",
      group: "preference:format",
      futureUtility: 3.9,
      userSpecificity: 3.0,
      repetition: 1.0,
      semanticWeight: 2.5,
      confidence: 0.95,
    },
    {
      regex: /不喜欢空话|模板废话|别再.*空话/i,
      summary: () => "User dislikes vague or filler-heavy answers.",
      group: "preference:style",
      futureUtility: 3.6,
      userSpecificity: 2.8,
      repetition: 0.9,
      semanticWeight: 2.2,
      confidence: 0.91,
    },
    {
      regex: /详细一点|展开一点|多给细节|更详细/i,
      summary: () => "User prefers more detailed answers.",
      group: "preference:detail",
      futureUtility: 3.7,
      userSpecificity: 3.1,
      repetition: 1.0,
      semanticWeight: 2.3,
      confidence: 0.92,
    },
    {
      regex: /以后.*用英文|英文回答|prefer english|use english|answer in english|reply in english|respond in english/i,
      summary: () => "User prefers English responses.",
      group: "preference:language",
      futureUtility: 3.7,
      userSpecificity: 3.1,
      semanticWeight: 2.5,
      confidence: 0.93,
    },
  ];

  return patterns
    .flatMap((pattern) => {
      const match = text.match(pattern.regex);
      if (!match) {
        return [];
      }
      return [
        {
          kind: "preference" as const,
          summary: pattern.summary(match),
          content: text,
          ttlDays: undefined,
          decayRate: 0.01,
          futureUtility: pattern.futureUtility ?? 3.4,
          userSpecificity: pattern.userSpecificity ?? 3.0,
          repetition: pattern.repetition ?? 1.0,
          semanticWeight: pattern.semanticWeight ?? 2.2,
          redundancy: pattern.redundancy ?? 0.35,
          confidence: pattern.confidence ?? 0.9,
          memoryGroup: pattern.group,
        },
      ];
    })
    .filter((candidate) => !/什么|吗|？|\?$/.test(candidate.summary));
}

function extractSemanticCandidates(text: string): CandidateSeed[] {
  const patterns: Array<{ regex: RegExp; summary: (match: RegExpMatchArray) => string; group: string }> = [
    {
      regex: /my name is (.+)/i,
      summary: (match) => `User name is ${sentenceFromText(match[1], 40)}.`,
      group: "semantic:user-name",
    },
    {
      regex: /我是(.+)/,
      summary: (match) => `Stable user fact: ${sentenceFromText(match[1])}.`,
      group: "semantic:user-fact",
    },
    {
      regex: /目标是(.+)/,
      summary: (match) => `Project goal: ${sentenceFromText(match[1])}.`,
      group: "semantic:goal",
    },
    {
      regex: /goal is to (.+)/i,
      summary: (match) => `Project goal: ${sentenceFromText(match[1])}.`,
      group: "semantic:goal",
    },
    {
      regex: /building (.+)/i,
      summary: (match) => `User is building ${sentenceFromText(match[1])}.`,
      group: "semantic:project",
    },
    {
      regex: /正在做(.+)/,
      summary: (match) => `User is working on ${sentenceFromText(match[1])}.`,
      group: "semantic:project",
    },
    {
      regex: /项目上下文[:：]?\s*(.+)/,
      summary: (match) => `Project context: ${sentenceFromText(match[1])}.`,
      group: "semantic:project",
    },
    {
      regex: /(?:当前项目|项目重点|主要聚焦|当前重点)[:：]?\s*(.+)/,
      summary: (match) => `Project focus: ${sentenceFromText(match[1])}.`,
      group: "semantic:project",
    },
    {
      regex: /(.+?)主要聚焦(.+)/,
      summary: (match) => `Project focus: ${sentenceFromText(`${match[1]} focuses on ${match[2]}`)}.`,
      group: "semantic:project",
    },
    {
      regex: /focus(?:es)? on (.+)/i,
      summary: (match) => `Project focus: ${sentenceFromText(match[1])}.`,
      group: "semantic:project",
    },
  ];

  return patterns.flatMap((pattern) => {
    const match = text.match(pattern.regex);
    if (!match) {
      return [];
    }
    return [
      {
        kind: "semantic" as const,
        summary: pattern.summary(match),
        content: text,
        ttlDays: undefined,
        decayRate: 0.02,
        futureUtility: 3.0,
        userSpecificity: 2.8,
        repetition: 0.8,
        semanticWeight: 2.0,
        redundancy: 0.4,
        confidence: 0.86,
        memoryGroup: pattern.group,
      },
      ];
    });
}

function hasPreferenceRequestSignal(text: string): boolean {
  return [
    /(?:以后|之后|从现在开始|默认).*(?:叫我|call me|用中文|用英文|中文回答|英文回答|answer in (?:chinese|english)|reply in (?:chinese|english)|respond in (?:chinese|english)|简洁|详细|结构化|结论|下一步)/i,
    /(?:请|请你|希望你|麻烦|可以|能不能).*(?:叫我|call me|用中文|用英文|中文回答|英文回答|answer in (?:chinese|english)|reply in (?:chinese|english)|respond in (?:chinese|english)|简洁|详细|结构化|结论|下一步)/i,
    /(?:叫我|call me|用中文|用英文|中文回答|英文回答|answer in (?:chinese|english)|reply in (?:chinese|english)|respond in (?:chinese|english)|简洁一点|详细一点|结构化).*(?:吗|么|吧|？|\?)$/i,
  ].some((pattern) => pattern.test(text));
}

function extractEpisodicCandidates(text: string): CandidateSeed[] {
  const candidates: CandidateSeed[] = [];
  if (/今天|刚刚|we fixed|修复了|决定了|完成了|finished|shipped|上线|实现了/i.test(text)) {
    candidates.push({
      kind: "episodic",
      summary: `Recent event: ${sentenceFromText(text)}.`,
      content: text,
      ttlDays: undefined,
      decayRate: 0.2,
      futureUtility: 1.6,
      userSpecificity: 1.4,
      repetition: 0.4,
      semanticWeight: 0.8,
      redundancy: 0.2,
      confidence: 0.7,
      memoryGroup: `episodic:${fingerprint(sentenceFromText(text, 40))}`,
    });
  }
  if (/readme\.md|README\.md|package\.json|AGENTS\.md/i.test(text)) {
    candidates.push({
      kind: "episodic",
      summary: `User referenced ${text.match(/README\.md|package\.json|AGENTS\.md/i)?.[0] ?? "a project file"}.`,
      content: text,
      ttlDays: undefined,
      decayRate: 0.24,
      futureUtility: 1.2,
      userSpecificity: 1.5,
      repetition: 0.1,
      semanticWeight: 0.6,
      redundancy: 0.2,
      confidence: 0.66,
      memoryGroup: "episodic:file-reference",
    });
  }
  return candidates;
}

function extractEntityKeys(text: string): string[] {
  const asciiEntities = Array.from(
    new Set(
      (text.match(/\b[A-Z][a-zA-Z0-9_-]{1,}\b/g) ?? [])
        .map((value) => value.toLowerCase())
        .filter((value) => value.length > 2),
    ),
  );
  const cjkEntities = Array.from(
    new Set(
      (text.match(/[\p{Script=Han}]{2,8}/gu) ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length >= 2),
    ),
  );

  return uniqueStrings([...asciiEntities, ...cjkEntities]).slice(0, 12);
}
