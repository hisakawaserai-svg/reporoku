import type { TFunction } from "i18next";
import { File } from "expo-file-system";
import type { Block, Session } from "../db/types";
import { toAbsoluteUri } from "./files";
import { REPORT_HEADING_TRANSLATION_KEYS, type ReportItem, type StructuredReport } from "./report";

const PHOTOS_HEADING_TRANSLATION_KEY = "report.section.photos";

// buildStructuredReport(template: "summary")が返す構造化データを直接HTML化する。写真だけは
// 別セクションとして末尾に追加する(構造化データ側のphotoEntryは「(写真)」プレースホルダの
// 位置情報のみを持ち、実画像はここで別途ファイルを読み込んで埋め込む)

function formatHHMM(unixMs: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(unixMs);
}

function formatDateSlash(unixMs: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { year: "numeric", month: "2-digit", day: "2-digit" }).format(unixMs);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ★・☑️・✅・❓・📷・📝が日本語本文と同じ行に混在すると、expo-print(WebViewベースのPDF化)の
// フォント選択でJPフォント側のグリフが優先され、色無しの記号にフォールバックすることがある
// (実機で確認済み: ❓が赤い色無しの記号になり、Apple Color Emojiの絵文字が使われない)。
// 該当の記号だけを明示的にfont-family: "Apple Color Emoji"のspanで囲み、確実に絵文字を使わせる
const EMOJI_MARK_PATTERN = /(☑️|✅|❓️?|📷|📝)/g;

function wrapEmojiSpans(escapedText: string): string {
  return escapedText.replace(EMOJI_MARK_PATTERN, '<span class="emoji">$1</span>');
}

function escapeAndWrapEmoji(text: string): string {
  return wrapEmojiSpans(escapeHtml(text));
}

// 構造化データの各行(ReportItem)を、その種別タグに基づいてHTMLタグへ変換する。
// 見出し文言(t())とレイアウト決定(行タイプ)が分離されているため、見出し文言を
// 変更してもここのHTML化ロジックには影響しない
function renderItemHtml(item: ReportItem, t: TFunction, lang: string): string {
  switch (item.kind) {
    case "bullet":
      return `<p class="bullet">${escapeAndWrapEmoji(item.text)}</p>`;
    case "qaPair":
      return [
        `<p class="qa-q">${escapeAndWrapEmoji(`${t("report.qa.questionPrefix")}${item.question}`)}</p>`,
        `<p class="qa-a">${escapeAndWrapEmoji(`${t("report.qa.answerPrefix")}${item.answer}`)}</p>`,
      ].join("\n");
    case "transcriptEntry": {
      const time = formatHHMM(item.time, lang);
      const prefix = item.marks ? `${item.marks} ` : "";
      const lines = [`<p>${escapeAndWrapEmoji(`[${time}] ${prefix}${item.text}`)}</p>`];
      if (item.answerText) {
        lines.push(`<p class="qa-a">${escapeAndWrapEmoji(`${t("report.qa.answerPrefix")}${item.answerText}`)}</p>`);
      }
      return lines.join("\n");
    }
    case "photoEntry": {
      const time = formatHHMM(item.time, lang);
      const prefix = item.marks ? `${item.marks} ` : "";
      return `<p>${escapeAndWrapEmoji(`[${time}] ${prefix}${t("report.transcript.photoLabel")}`)}</p>`;
    }
  }
}

function renderStructuredAsHtml(structured: StructuredReport, t: TFunction, lang: string): string {
  const title = structured.header.titleText || t("notes.untitledNote");
  const dateTimeLine = t("report.meta.dateTimeLine", {
    date: formatDateSlash(structured.header.startedAt, lang),
    start: formatHHMM(structured.header.startedAt, lang),
    end: formatHHMM(structured.header.endedAt, lang),
  });

  const parts = [`<h1 class="title">${escapeHtml(title)}</h1>`, `<p class="meta">${escapeAndWrapEmoji(dateTimeLine)}</p>`];

  for (const section of structured.sections) {
    parts.push(`<h2 class="heading">${escapeAndWrapEmoji(t(REPORT_HEADING_TRANSLATION_KEYS[section.heading]))}</h2>`);
    section.items.forEach((item) => parts.push(renderItemHtml(item, t, lang)));
  }

  return parts.join("\n");
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".webp": "image/webp",
};

function guessMimeType(uri: string): string {
  const match = uri.toLowerCase().match(/\.[a-z0-9]+$/);
  return (match && EXTENSION_MIME_TYPES[match[0]]) || "image/jpeg";
}

// 写真ブロックを時系列順(startMs順)に並べ、base64のdata URIとして埋め込む。
// file://等のローカルURIをそのまま<img src>に渡すとPDF生成環境によっては読み込めないことがあるため、
// 確実に埋め込めるbase64化を選ぶ(1件読み込みに失敗しても他の写真はそのまま出力を続ける)
async function renderPhotosSection(photoBlocks: Block[], session: Session, t: TFunction, lang: string): Promise<string> {
  if (photoBlocks.length === 0) return "";

  const items = await Promise.all(
    photoBlocks.map(async (block) => {
      if (!block.photoUri) return null;
      try {
        const absoluteUri = toAbsoluteUri(block.photoUri);
        const file = new File(absoluteUri);
        if (!file.exists) return null;
        const base64 = await file.base64();
        const mime = guessMimeType(absoluteUri);
        const time = formatHHMM(session.startedAt + block.startMs, lang);
        return `<div class="photo-item">
          <p class="photo-time">[${time}]</p>
          <img class="photo-img" src="data:${mime};base64,${base64}" />
        </div>`;
      } catch (e) {
        console.warn("[PDF] 写真の読み込みに失敗しました", e);
        return null;
      }
    })
  );

  const photoHtml = items.filter((html): html is string => !!html);
  if (photoHtml.length === 0) return "";

  return `<h2 class="heading">${escapeAndWrapEmoji(t(PHOTOS_HEADING_TRANSLATION_KEY))}</h2>\n<div class="photo-grid">${photoHtml.join("\n")}</div>`;
}

// 本文は日本語表示用のシステムフォントに任せる。★・☑️・✅・❓・📷・📝(.emojiクラス、
// wrapEmojiSpansで囲む)だけは明示的にApple Color Emojiフォントを指定し、日本語フォント側の
// モノクロ字形が優先されて色が付かなくなるのを防ぐ
const STYLE = `
  @page { margin: 28px 32px; }
  body {
    font-family: -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
    color: #1c1c1e;
    font-size: 13px;
    line-height: 1.6;
  }
  .emoji { font-family: "Apple Color Emoji", -apple-system, sans-serif; }
  .title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #3c3c43; margin: 0 0 16px; }
  .heading { font-size: 15px; font-weight: 700; margin: 20px 0 8px; }
  .bullet { margin: 0 0 4px; padding-left: 1em; text-indent: -1em; }
  .bullet::before { content: "・"; }
  .qa-q { margin: 10px 0 0; font-weight: 600; }
  .qa-a { margin: 2px 0 0; color: #3c3c43; }
  .photo-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
  .photo-item { width: 45%; }
  .photo-time { font-size: 11px; color: #8e8e93; margin: 0 0 4px; }
  .photo-img { width: 100%; border-radius: 6px; }
`;

export async function buildReportPdfHtml(
  structured: StructuredReport,
  blocks: Block[],
  session: Session,
  t: TFunction,
  lang: string
): Promise<string> {
  const bodyHtml = renderStructuredAsHtml(structured, t, lang);

  const photoBlocks = [...blocks]
    .filter((b) => b.kind === "photo" && b.photoUri)
    .sort((a, b) => a.startMs - b.startMs);
  const photosHtml = await renderPhotosSection(photoBlocks, session, t, lang);

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <style>${STYLE}</style>
</head>
<body>
  ${bodyHtml}
  ${photosHtml}
</body>
</html>`;
}

export function reportPdfFileName(session: Session, t: TFunction): string {
  const safeTitle = session.title.trim().replace(/[\\/:*?"<>|]/g, "_") || t("report.fileNameFallback");
  return `${safeTitle}.pdf`;
}
