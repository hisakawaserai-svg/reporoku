import type { TFunction } from "i18next";
import type { Block, Session } from "../db/types";

export type ReportTemplate = "summary" | "full";

// タイムライン(NoteDetailScreen)のセクション分けと同じ考え方の、表示専用の再実装。
// レポート出力はDB更新を一切伴わないため、既存のタイムライン描画ロジックには触れず、
// 同じ推定式(発話継続時間・間隔)だけをここに複製している
const MS_PER_CHAR = 150;

function estimateBlockDurationMs(block: Block): number {
  if (block.kind !== "transcript" || !block.text) return 0;
  return block.text.length * MS_PER_CHAR;
}

function gapMsBetween(prev: Block, next: Block): number {
  const prevEndMs = prev.endMs ?? prev.startMs + estimateBlockDurationMs(prev);
  return Math.max(0, next.startMs - prevEndMs);
}

function groupByGap(blocks: Block[], sectionGapMs: number): Block[][] {
  const groups: Block[][] = [];
  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    if (!prev || gapMsBetween(prev, block) >= sectionGapMs) {
      groups.push([block]);
    } else {
      groups[groups.length - 1].push(block);
    }
  });
  return groups;
}

// レポートの見出しの種類。実際の文言(t()での解決)はレンダラー(text/HTML)側の責務とし、
// このモジュールでは種別タグのみを扱う
export type ReportHeadingKey = "stars" | "todos" | "questions" | "memos" | "qa" | "transcript";

// 見出しの翻訳キー対応表。text/HTML両レンダラーで共有し、見出し文言の二重管理を避ける
export const REPORT_HEADING_TRANSLATION_KEYS: Record<ReportHeadingKey, string> = {
  stars: "report.section.stars",
  todos: "report.section.todos",
  questions: "report.section.questions",
  memos: "report.section.memos",
  qa: "report.section.qa",
  transcript: "report.section.transcript",
};

export interface ReportHeader {
  // 空文字は「無題」を意味する。無題時のフォールバック文言はレンダラー側でt("notes.untitledNote")を当てる
  titleText: string;
  startedAt: number;
  endedAt: number;
}

export type ReportItem =
  | { kind: "bullet"; text: string }
  | { kind: "qaPair"; question: string; answer: string }
  | {
      kind: "transcriptEntry";
      time: number;
      marks: string;
      text: string;
      answerText?: string;
      // セクション区切り(gap)の先頭かどうか。テキスト版は空行、HTML版は無視して構わない
      isGroupStart: boolean;
    }
  | { kind: "photoEntry"; time: number; marks: string; isGroupStart: boolean };

export interface ReportSection {
  heading: ReportHeadingKey;
  items: ReportItem[];
}

export interface StructuredReport {
  header: ReportHeader;
  // 該当0件のセクションは、この時点で除外済み
  sections: ReportSection[];
}

// ★のブロックは、一言メモ(summary_note)があればそれを優先し、無ければ元の発言テキストを使う
function starContent(block: Block): string {
  return (block.summaryNote?.trim() || block.text || "").trim();
}

// question_termを「回答メモ」として転用しているため、非空なら解決済み扱い(blocksRepo.answerQuestionと同じ判定)
function isResolvedQuestion(block: Block): boolean {
  return !!block.questionTerm?.trim();
}

function blockMarks(block: Block): string {
  let marks = "";
  if (block.isStarred) marks += "★";
  if (block.isTodo) marks += block.todoDone ? "✅" : "☑️";
  if (block.isQuestion) marks += "❓";
  return marks;
}

// 「要点抜粋」の各セクション(★・☑️/✅・❓・メモ・Q&A)。該当0件のセクションは含めない
function buildExcerptSections(blocks: Block[]): ReportSection[] {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const sections: ReportSection[] = [];

  const starItems = sorted
    .filter((b) => b.isStarred)
    .map(starContent)
    .filter(Boolean)
    .map((text): ReportItem => ({ kind: "bullet", text }));
  if (starItems.length > 0) sections.push({ heading: "stars", items: starItems });

  const todoItems = sorted
    .filter((b) => b.isTodo)
    .map((b) => ({ mark: b.todoDone ? "✅" : "☑️", text: (b.text ?? "").trim() }))
    .filter((t) => t.text)
    .map((t): ReportItem => ({ kind: "bullet", text: `${t.mark} ${t.text}` }));
  if (todoItems.length > 0) sections.push({ heading: "todos", items: todoItems });

  // 保留中(is_deferred)のものは、未解決であっても「確認事項」からは除外する
  const questionItems = sorted
    .filter((b) => b.isQuestion && !isResolvedQuestion(b) && !b.isDeferred)
    .map((b) => (b.text ?? "").trim())
    .filter(Boolean)
    .map((text): ReportItem => ({ kind: "bullet", text }));
  if (questionItems.length > 0) sections.push({ heading: "questions", items: questionItems });

  const memoItems = sorted
    .filter((b) => b.kind === "note")
    .map((b) => (b.text ?? "").trim())
    .filter(Boolean)
    .map((text): ReportItem => ({ kind: "bullet", text }));
  if (memoItems.length > 0) sections.push({ heading: "memos", items: memoItems });

  const qaItems = sorted
    .filter((b) => b.isQuestion && isResolvedQuestion(b))
    .map(
      (block): ReportItem => ({
        kind: "qaPair",
        question: (block.text ?? "").trim(),
        answer: (block.questionTerm ?? "").trim(),
      })
    );
  if (qaItems.length > 0) sections.push({ heading: "qa", items: qaItems });

  return sections;
}

// 「全文」テンプレートに追記する、セクション分けを反映した通常のタイムライン全文
function buildFullTranscriptSection(blocks: Block[], session: Session): ReportSection | null {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const groups = groupByGap(sorted, session.sectionGapMs);
  const items: ReportItem[] = [];

  groups.forEach((group) => {
    // 元の実装(buildFullTranscriptLines)は、グループの何番目のブロックが実際に描画されるかに
    // 関わらず「グループの先頭で1回だけ空行を入れる」ため、isGroupStartも生のブロック位置ではなく
    // 「そのグループで最初に実際にitem化されたもの」を基準にする(先頭ブロックが空文字で
    // スキップされた場合に、区切りの空行がずれないようにするため)
    let isFirstEmittedInGroup = true;
    group.forEach((block) => {
      const time = session.startedAt + block.startMs;
      const marks = blockMarks(block);

      if (block.kind === "photo") {
        items.push({ kind: "photoEntry", time, marks, isGroupStart: isFirstEmittedInGroup });
        isFirstEmittedInGroup = false;
        return;
      }

      const text = (block.text ?? "").trim();
      if (!text) return;
      items.push({
        kind: "transcriptEntry",
        time,
        marks,
        text,
        answerText: block.isQuestion && block.questionTerm?.trim() ? block.questionTerm.trim() : undefined,
        isGroupStart: isFirstEmittedInGroup,
      });
      isFirstEmittedInGroup = false;
    });
  });

  if (items.length === 0) return null;
  return { heading: "transcript", items };
}

export function buildStructuredReport(session: Session, blocks: Block[], template: ReportTemplate): StructuredReport {
  const header: ReportHeader = {
    titleText: session.title.trim(),
    startedAt: session.startedAt,
    endedAt: session.startedAt + session.durationMs,
  };

  const sections = buildExcerptSections(blocks);
  if (template === "full") {
    const transcriptSection = buildFullTranscriptSection(blocks, session);
    if (transcriptSection) sections.push(transcriptSection);
  }

  return { header, sections };
}

function formatHHMM(unixMs: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(unixMs);
}

function formatDateSlash(unixMs: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { year: "numeric", month: "2-digit", day: "2-digit" }).format(unixMs);
}

function headerLines(header: ReportHeader, t: TFunction, lang: string): string[] {
  const title = header.titleText || t("notes.untitledNote");
  const dateTimeLine = t("report.meta.dateTimeLine", {
    date: formatDateSlash(header.startedAt, lang),
    start: formatHHMM(header.startedAt, lang),
    end: formatHHMM(header.endedAt, lang),
  });
  return [title, dateTimeLine];
}

function itemLines(item: ReportItem, t: TFunction, lang: string): string[] {
  switch (item.kind) {
    case "bullet":
      return [`・${item.text}`];
    case "qaPair":
      return [
        ` ${t("report.qa.questionPrefix")}${item.question}`,
        ` ${t("report.qa.answerPrefix")}${item.answer}`,
      ];
    case "transcriptEntry": {
      const time = formatHHMM(item.time, lang);
      const prefix = item.marks ? `${item.marks} ` : "";
      const lines = [`[${time}] ${prefix}${item.text}`];
      if (item.answerText) lines.push(`       ${t("report.qa.answerPrefix")}${item.answerText}`);
      return lines;
    }
    case "photoEntry": {
      const time = formatHHMM(item.time, lang);
      const prefix = item.marks ? `${item.marks} ` : "";
      return [`[${time}] ${prefix}${t("report.transcript.photoLabel")}`];
    }
  }
}

export function buildReportText(structured: StructuredReport, t: TFunction, lang: string): string {
  const lines = [...headerLines(structured.header, t, lang)];

  for (const section of structured.sections) {
    lines.push("", `■ ${t(REPORT_HEADING_TRANSLATION_KEYS[section.heading])}`);
    if (section.heading === "qa" || section.heading === "transcript") {
      section.items.forEach((item, i) => {
        if (section.heading === "qa" && i > 0) lines.push("");
        if (section.heading === "transcript" && isTranscriptGroupStart(item) && i > 0) lines.push("");
        lines.push(...itemLines(item, t, lang));
      });
    } else {
      section.items.forEach((item) => lines.push(...itemLines(item, t, lang)));
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function isTranscriptGroupStart(item: ReportItem): boolean {
  return (item.kind === "transcriptEntry" || item.kind === "photoEntry") && item.isGroupStart;
}

export function reportFileName(session: Session, t: TFunction): string {
  const safeTitle = session.title.trim().replace(/[\\/:*?"<>|]/g, "_") || t("report.fileNameFallback");
  return `${safeTitle}.txt`;
}
