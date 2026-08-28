#!/usr/bin/env node
// CHANGELOG/ の各ファイルが CHANGELOG/README.md の決まりに従っているかを検査する。
//
// **書いた本人が気づきにくい種類のミスだけを見る。**
//   - 500 字（Google Play の上限）を超えた
//   - ストアに入る本文へ Markdown 記法が混ざった（`-` や `**` は記号のまま表示される）
//   - コミットハッシュの付け忘れ・打ち間違い（rebase で消えたものを含む）
// 文章の良し悪しは見ない。人が読めば分かることを機械に判定させない。
//
// 使い方:
//   node CHANGELOG/check-changelog.mjs            すべて
//   node CHANGELOG/check-changelog.mjs 1.1.0      そのバージョンだけ
//   node CHANGELOG/check-changelog.mjs 1.0.0 1.1.0
//
// 依存なし（Node の標準モジュールだけ）。**どこから実行してもよい** ──
// 見に行く先も git を回す場所も、このファイル自身の位置から決めている。

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 検査する先は、このスクリプトが置いてあるディレクトリ自身（CHANGELOG/） */
const DIR = dirname(fileURLToPath(import.meta.url));
/** 画面に出すときの見え方。フルパスは長いので CHANGELOG/1.1.0.md の形にする */
const LABEL = basename(DIR);
/** Google Play のリリースノートの上限（1 言語あたり）。App Store の 4000 より厳しい方に合わせる */
const MAX_CHARS = 500;
/** ファイル名は 3 桁固定。1.1.md と 1.1.2.md が並ぶと辞書順が狂うため（README 参照） */
const FILE_NAME = /^(\d+)\.(\d+)\.(\d+)\.md$/;
/** 短縮ハッシュ。7 桁以上を求める（git の既定は 7） */
const HASH = /\(([0-9a-f]{7,40})(?:,\s*[0-9a-f]{7,40})*\)\s*$/;
/** ハッシュの代わりに認める断り書き */
const NO_HASH_REASONS = ['(コミットなし・ストア側のみ)'];
/** 節ごとにハッシュを免除する印。`<!-- no-hash: 理由 -->` を節の中に置く */
const NO_HASH_MARKER = /<!--\s*no-hash:/;

const problems = [];
const note = (file, line, message) => problems.push({ file, line, message });

/**
 * git リポジトリの中で動いているか。**外なら、ハッシュの検査はまとめて諦める。**
 * 「確認できない」と「実在しない」を混ぜると、リポジトリ外にコピーしただけで
 * 全項目が真っ赤になり、本物の打ち間違いが埋もれる。
 */
const gitAvailable = (() => {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: DIR, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** そのコミットがこのリポジトリに実在するか */
function commitExists(hash) {
  if (!gitAvailable) return true;
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: DIR, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkFile(name) {
  const path = join(LABEL, name);
  const text = readFileSync(join(DIR, name), 'utf8');
  const lines = text.split('\n');

  const matched = name.match(FILE_NAME);
  if (!matched) {
    note(path, 1, `ファイル名が <major>.<minor>.<patch>.md ではない`);
    return;
  }
  const version = matched.slice(1).join('.');

  // 1) 見出しがファイル名と一致するか
  if (lines[0] !== `# ${version}`) {
    note(path, 1, `見出しが "# ${version}" ではない（"${lines[0]}"）`);
  }

  // 2) 必須の節
  for (const heading of ['## リリース状況', '## リリースノート']) {
    if (!text.includes(`\n${heading}\n`)) note(path, 1, `${heading} が無い`);
  }

  // 3) ストアへ貼る本文。```text ブロックがちょうど 1 つ
  const blocks = [...text.matchAll(/```text\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) {
    note(path, 1, `\`\`\`text ブロックが ${blocks.length} 個（1 つにする）`);
  } else {
    const body = blocks[0][1];
    const startLine = text.slice(0, blocks[0].index).split('\n').length;

    if (body.length > MAX_CHARS) {
      note(path, startLine, `リリースノートが ${body.length} 字（上限 ${MAX_CHARS}）`);
    }
    body.split('\n').forEach((line, i) => {
      if (/^\s*([-*#>]|\d+\.)\s/.test(line)) {
        note(path, startLine + 1 + i, `本文に Markdown 記法「${line.trim().slice(0, 12)}」── 記号のまま表示される`);
      }
      if (line.includes('**')) {
        note(path, startLine + 1 + i, `本文に "**" ── 記号のまま表示される`);
      }
    });
    // 群の区切りは空行 1 つ（2 つ以上空けるとストアの狭い欄で 1 画面に入らない）
    if (/\n\n\n/.test(body)) note(path, startLine, '本文に空行が 2 つ以上続く箇所がある');
  }

  // 4) 日付の形
  lines.forEach((line, i) => {
    for (const found of line.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(found[0])) {
        note(path, i + 1, `日付が YYYY-MM-DD ではない（${found[0]}）`);
      }
    }
  });

  // 5) 「変更の記録」の各項目にコミットハッシュ
  const recordStart = lines.findIndex((l) => l === '## 変更の記録');
  if (recordStart >= 0) {
    let exempt = false;
    for (let i = recordStart + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith('## ')) break;
      // 節が変わったら免除は解除する
      if (line.startsWith('### ')) exempt = false;
      if (NO_HASH_MARKER.test(line)) exempt = true;
      if (!line.startsWith('- ') || exempt) continue;

      if (NO_HASH_REASONS.some((reason) => line.trimEnd().endsWith(reason))) continue;

      const hashes = line.match(HASH);
      if (!hashes) {
        note(path, i + 1, `コミットハッシュが無い: ${line.slice(0, 40)}…`);
        continue;
      }
      for (const hash of hashes[0].replace(/[()]/g, '').split(/,\s*/)) {
        if (!commitExists(hash)) {
          note(path, i + 1, `コミット ${hash} がこのリポジトリに無い`);
        }
      }
    }
  }
}

const wanted = process.argv.slice(2);
const all = readdirSync(DIR).filter((f) => FILE_NAME.test(f));
const targets = wanted.length
  ? wanted.map((v) => (v.endsWith('.md') ? v : `${v}.md`))
  : all.sort((a, b) => {
      // 辞書順ではなく数値で並べる（1.10.0 が 1.2.0 より前に来ないように）
      const na = a.match(FILE_NAME).slice(1).map(Number);
      const nb = b.match(FILE_NAME).slice(1).map(Number);
      return na[0] - nb[0] || na[1] - nb[1] || na[2] - nb[2];
    });

for (const name of targets) {
  if (!all.includes(name)) {
    note(join(LABEL, name), 1, 'ファイルが無い');
    continue;
  }
  checkFile(name);
}

if (!gitAvailable) {
  console.log('※ git が使えないため、コミットハッシュの実在は確認していません');
}

if (problems.length === 0) {
  console.log(`OK: ${targets.length} 件すべて決まりどおり（${targets.join(', ')}）`);
  process.exit(0);
}

for (const { file, line, message } of problems) {
  console.error(`${file}:${line} ${message}`);
}
console.error(`\n${problems.length} 件の問題`);
process.exit(1);
