import { genId } from "./id";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import type { BlockKind } from "../db/types";

// 開発者向け: 設定画面からタップ一つでノート詳細/ToDo/用語集の見た目を
// 確認できるテストデータ(セッション3件・ブロック各種)を投入する。
// 既存の録音・文字起こしロジックは使わず、通常の保存経路(sessionsRepo/blocksRepo)を
// そのまま呼び出すだけなので、本番のデータ形式と完全に一致する
export async function seedDevTestData(): Promise<void> {
  const now = Date.now();

  type BlockSeed = {
    kind?: BlockKind;
    startMs: number;
    text?: string | null;
    isStarred?: boolean;
    isTodo?: boolean;
    isQuestion?: boolean;
    questionTerm?: string | null;
    todoDone?: boolean;
  };

  const createSessionWithBlocks = async (
    title: string,
    startedAt: number,
    durationMs: number,
    blockSeeds: BlockSeed[]
  ) => {
    const session = await sessionsRepo.create({ id: genId(), title, startedAt, durationMs });
    for (const seed of blockSeeds) {
      const block = await blocksRepo.create({
        id: genId(),
        sessionId: session.id,
        kind: seed.kind ?? "transcript",
        startMs: seed.startMs,
        text: seed.text ?? null,
        isStarred: seed.isStarred,
        isTodo: seed.isTodo,
        isQuestion: seed.isQuestion,
        questionTerm: seed.questionTerm,
      });
      if (seed.todoDone) {
        await blocksRepo.toggleTodoDone(block.id);
      }
    }
  };

  // ノート1: 研修 ― タイムラインのセクション区切り・★/?/ToDo/写真プレースホルダー確認用
  await createSessionWithBlocks("2026/08/21 の研修", now - 60 * 60 * 1000, 20 * 60 * 1000, [
    { startMs: 0, text: "本日は新人研修についてご説明します。まず全体のスケジュールを確認しましょう。" },
    { startMs: 3000, text: "パスワードは使い回さないこと。必ず社内規定に従うこと。", isStarred: true },
    { startMs: 6500, text: "次にセキュリティ方針についてです。" },
    { kind: "photo", startMs: 9000 },
    { startMs: 720000, text: "ここからは実技演習に移ります。" },
    {
      startMs: 723000,
      text: "実技演習の評価基準はどこで確認できますか。",
      isQuestion: true,
      questionTerm: "評価基準",
    },
    { startMs: 727000, text: "演習レポートを8/30までに提出する", isTodo: true },
  ]);

  // ノート2: 営業ミーティング ― ToDoの未対応/完了、用語集の漢字語確認用
  await createSessionWithBlocks("営業ミーティング", now - 2 * 60 * 60 * 1000, 10 * 60 * 1000, [
    { startMs: 0, text: "議事録をチームに共有する", isTodo: true },
    { startMs: 60000, text: "会議室を予約する", isTodo: true, todoDone: true },
    {
      startMs: 120000,
      text: "与信管理という言葉が出てきた",
      isQuestion: true,
      questionTerm: "与信管理",
    },
  ]);

  // ノート3: セキュリティ勉強会 ― 用語集の複数行、ToDo完了確認用
  await createSessionWithBlocks("セキュリティ勉強会", now - 3 * 60 * 60 * 1000, 15 * 60 * 1000, [
    { startMs: 0, text: "ゼロトラストについて学んだ", isQuestion: true, questionTerm: "ゼロトラスト" },
    { startMs: 60000, text: "シャドーイングの練習方法", isQuestion: true, questionTerm: "シャドーイング" },
    { startMs: 120000, text: "研修資料をアーカイブする", isTodo: true, todoDone: true },
    { startMs: 180000, text: "2段階認証を8/30までに設定する", isTodo: true },
  ]);
}
