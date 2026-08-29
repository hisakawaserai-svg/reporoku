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

function formatHHMM(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateSlash(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function headerLines(session: Session): string[] {
  const start = session.startedAt;
  const end = session.startedAt + session.durationMs;
  return [`【受講報告】${session.title}`, `日時：${formatDateSlash(start)} ${formatHHMM(start)}〜${formatHHMM(end)}`];
}

// ★のブロックは、一言メモ(summary_note)があればそれを優先し、無ければ元の発言テキストを使う
function starContent(block: Block): string {
  return (block.summaryNote?.trim() || block.text || "").trim();
}

// question_termを「回答メモ」として転用しているため、非空なら解決済み扱い(blocksRepo.answerQuestionと同じ判定)
function isResolvedQuestion(block: Block): boolean {
  return !!block.questionTerm?.trim();
}

function buildSection(heading: string, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return ["", `■ ${heading}`, ...lines.map((line) => `・${line}`)];
}

// 「要点抜粋」テンプレートの本文(★・📝・❓のみ)。該当0件のセクションは見出しごと省略する
export function buildExcerptSections(blocks: Block[]): string[] {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);

  const starLines = sorted.filter((b) => b.isStarred).map(starContent).filter(Boolean);

  const todoLines = sorted
    .filter((b) => b.isTodo)
    .map((b) => (b.text ?? "").trim())
    .filter(Boolean);

  // 保留中(is_deferred)のものは、未解決であっても「確認事項」からは除外する
  const openQuestionLines = sorted
    .filter((b) => b.isQuestion && !isResolvedQuestion(b) && !b.isDeferred)
    .map((b) => (b.text ?? "").trim())
    .filter(Boolean);

  const qaBlocks = sorted.filter((b) => b.isQuestion && isResolvedQuestion(b));

  const lines: string[] = [];
  lines.push(...buildSection("重要なポイント", starLines));
  lines.push(...buildSection("今後のアクション", todoLines));
  lines.push(...buildSection("確認事項", openQuestionLines));

  if (qaBlocks.length > 0) {
    lines.push("", "■ Q&A");
    for (const block of qaBlocks) {
      lines.push(`・Q：${(block.text ?? "").trim()}`);
      lines.push(`  A：${(block.questionTerm ?? "").trim()}`);
    }
  }

  return lines;
}

function blockMarks(block: Block): string {
  let marks = "";
  if (block.isStarred) marks += "★";
  if (block.isTodo) marks += "📝";
  if (block.isQuestion) marks += "❓";
  return marks;
}

// 「全文」テンプレートに追記する、セクション分けを反映した通常のタイムライン全文
export function buildFullTranscriptLines(blocks: Block[], session: Session): string[] {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const groups = groupByGap(sorted, session.sectionGapMs);
  const lines: string[] = ["", "■ 全体文字起こしログ"];

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) lines.push("");
    for (const block of group) {
      const time = formatHHMM(session.startedAt + block.startMs);
      const marks = blockMarks(block);
      const prefix = marks ? `${marks} ` : "";

      if (block.kind === "photo") {
        lines.push(`[${time}] ${prefix}(写真)`);
        continue;
      }

      const text = (block.text ?? "").trim();
      if (!text) continue;
      lines.push(`[${time}] ${prefix}${text}`);
      if (block.isQuestion && block.questionTerm?.trim()) {
        lines.push(`       A：${block.questionTerm.trim()}`);
      }
    }
  });

  return lines;
}

export function buildReportText(session: Session, blocks: Block[], template: ReportTemplate): string {
  const lines = [...headerLines(session), ...buildExcerptSections(blocks)];
  if (template === "full") {
    lines.push(...buildFullTranscriptLines(blocks, session));
  }
  return `${lines.join("\n").trim()}\n`;
}

export function reportFileName(session: Session): string {
  const safeTitle = session.title.trim().replace(/[\\/:*?"<>|]/g, "_") || "レポート";
  return `${safeTitle}.txt`;
}
