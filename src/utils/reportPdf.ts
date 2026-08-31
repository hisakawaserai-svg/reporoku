import { File } from "expo-file-system";
import type { Block, Session } from "../db/types";
import { toAbsoluteUri } from "./files";
import { buildReportText } from "./report";

// 「要点抜粋」テキスト(buildReportText)をそのままHTML化し、写真だけは別セクションとして
// 末尾に追加する。テキスト出力側の組み立てロジック(report.ts)には一切手を加えない

function formatHHMM(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
// 該当の記号だけを明示的にfont-family: "Apple Color Emoji"のspanで囲み、確実に絵文字を使わせる。
// テキスト出力(report.ts)の文字列自体は書き換えず、PDF描画のHTML化の時だけ行う
const EMOJI_MARK_PATTERN = /(☑️|✅|❓️?|📷|📝)/g;

function wrapEmojiSpans(escapedText: string): string {
  return escapedText.replace(EMOJI_MARK_PATTERN, '<span class="emoji">$1</span>');
}

// buildReportText(template: "summary")が返す行を、行頭の記号(■見出し・・箇条書き・Q/A)から
// 判定してそれぞれのHTMLタグに変換する。空行はセクション間の余白として扱う(CSSのmarginに置き換える)
function renderTextAsHtml(text: string): string {
  const lines = text.split("\n");
  const htmlParts: string[] = [];
  let isFirstLine = true;

  for (const line of lines) {
    if (line === "") continue;
    const escaped = wrapEmojiSpans(escapeHtml(line));

    if (isFirstLine) {
      htmlParts.push(`<h1 class="title">${escaped}</h1>`);
      isFirstLine = false;
    } else if (line.startsWith("日時：")) {
      htmlParts.push(`<p class="meta">${escaped}</p>`);
    } else if (line.startsWith("■ ")) {
      htmlParts.push(`<h2 class="heading">${wrapEmojiSpans(escapeHtml(line.slice(2)))}</h2>`);
    } else if (line.startsWith("・")) {
      htmlParts.push(`<p class="bullet">${wrapEmojiSpans(escapeHtml(line.slice(1)))}</p>`);
    } else if (line.startsWith(" Q：")) {
      htmlParts.push(`<p class="qa-q">${wrapEmojiSpans(escapeHtml(line.slice(1)))}</p>`);
    } else if (line.startsWith(" A：")) {
      htmlParts.push(`<p class="qa-a">${wrapEmojiSpans(escapeHtml(line.slice(1)))}</p>`);
    } else {
      htmlParts.push(`<p>${escaped}</p>`);
    }
  }

  return htmlParts.join("\n");
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
async function renderPhotosSection(photoBlocks: Block[], session: Session): Promise<string> {
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
        const time = formatHHMM(session.startedAt + block.startMs);
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

  return `<h2 class="heading">${wrapEmojiSpans("写真 📷")}</h2>\n<div class="photo-grid">${photoHtml.join("\n")}</div>`;
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

export async function buildReportPdfHtml(session: Session, blocks: Block[]): Promise<string> {
  const bodyHtml = renderTextAsHtml(buildReportText(session, blocks, "summary"));

  const photoBlocks = [...blocks]
    .filter((b) => b.kind === "photo" && b.photoUri)
    .sort((a, b) => a.startMs - b.startMs);
  const photosHtml = await renderPhotosSection(photoBlocks, session);

  return `<!doctype html>
<html lang="ja">
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

export function reportPdfFileName(session: Session): string {
  const safeTitle = session.title.trim().replace(/[\\/:*?"<>|]/g, "_") || "レポート";
  return `${safeTitle}.pdf`;
}
