import { Directory, File, Paths } from "expo-file-system";
import { genId } from "./id";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import { deleteStoredFile, listAudioDirectoryEntries } from "./files";
import { padWavToDurationMs } from "./audioMerge";
import type { BlockKind, QuestionKind } from "../db/types";

// 開発者向け: 設定画面から、ストア撮影用のノート(日英で同じ構成)を投入する。
// 既存の録音ロジックは使わず、通常の保存経路だけを通す。

export type DevTestDataLocale = "ja" | "en";

type BlockSeed = {
  kind?: BlockKind;
  startMs: number;
  text?: string | null;
  isStarred?: boolean;
  isTodo?: boolean;
  isQuestion?: boolean;
  questionKind?: QuestionKind | null;
  todoDone?: boolean;
  answer?: string | null;
  summaryNote?: string;
  importantGroup?: string;
};

type SessionSeed = {
  title: string;
  startedOffsetMs: number;
  hour: number;
  minute: number;
  durationMs: number;
  blocks: BlockSeed[];
};

function startedAtFromSeed(seed: SessionSeed): number {
  const d = new Date(Date.now() - seed.startedOffsetMs);
  d.setHours(seed.hour, seed.minute, 0, 0);
  return d.getTime();
}

const seedIdsFile = new File(Paths.document, "devSeedSessionIds.json");

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

const JA_SESSIONS: SessionSeed[] = [
  {
    title: "新人セキュリティ研修",
    startedOffsetMs: 1 * DAY,
    hour: 10,
    minute: 41,
    durationMs: 45 * MIN,
    blocks: [
      {
        startMs: 2000,
        text: "本日は新人研修についてご説明します。まず全体のスケジュールを確認しましょう。",
      },
      {
        startMs: 11000,
        text: "パスワードは使い回さないこと。必ず社内規定に従うこと。",
        isStarred: true,
        importantGroup: "パスワード",
        summaryNote: "12文字以上。使い回し禁止。",
      },
      { startMs: 18000, text: "次にセキュリティ方針についてです。" },
      {
        startMs: 52000,
        text: "不審なメールの添付ファイルは、差出人が社内でも安易に開かないこと。",
        isStarred: true,
        importantGroup: "メール",
      },
      { startMs: 95000, text: "次に、アカウントを守るための設定です。" },
      { startMs: 125000, text: "2段階認証を8月30日までに設定する", isTodo: true },
      {
        startMs: 155000,
        text: "ゼロトラストは、社内ネットワークでも毎回確認するということで合っていますか。",
        isQuestion: true,
        questionKind: "question",
        answer: "はい。場所を信頼せず、アクセスのたびに確認する考え方です。",
      },
      { kind: "note", startMs: 210000, text: "次回は演習形式。自分の端末で設定を試す。" },
      { startMs: 480000, text: "ここからは実技演習に入ります。資料はポータルにあります。" },
      { startMs: 510000, text: "演習レポートを8月30日までに提出する", isTodo: true },
      {
        startMs: 540000,
        text: "実技演習の評価基準は、どこで確認できますか。",
        isQuestion: true,
        questionKind: "question",
      },
      {
        startMs: 570000,
        text: "合格ラインは80点からです。ポータルの研修ページに掲載されています。",
        isStarred: true,
        importantGroup: "演習",
      },
    ],
  },
  {
    title: "朝会",
    startedOffsetMs: 2 * DAY,
    hour: 9,
    minute: 0,
    durationMs: 12 * MIN,
    blocks: [
      { startMs: 0, text: "今週の朝会を始めます。各自、今日の予定を共有してください。" },
      { startMs: 40000, text: "今日中に日報のテンプレを新しいフォーマットへ直す", isTodo: true },
      {
        startMs: 80000,
        text: "今週の目標共有は、どのチャンネルに書けばいいですか。",
        isQuestion: true,
        questionKind: "question",
      },
      {
        startMs: 110000,
        text: "顧客への折り返しは、当日中を徹底すること。",
        isStarred: true,
        importantGroup: "連絡",
      },
    ],
  },
  {
    title: "営業定例ミーティング",
    startedOffsetMs: 4 * DAY,
    hour: 14,
    minute: 0,
    durationMs: 32 * MIN,
    blocks: [
      { startMs: 0, text: "今日の営業定例を始めます。先方への見積もりが残件です。" },
      { startMs: 40000, text: "議事録をチームのチャンネルに共有する", isTodo: true },
      { startMs: 90000, text: "会議室を来週火曜で予約する", isTodo: true, todoDone: true },
      {
        startMs: 150000,
        text: "与信管理の確認は、見積もりを出す前と後のどちらですか。",
        isQuestion: true,
        questionKind: "question",
      },
      {
        startMs: 210000,
        text: "この見積もりはいつまでに先方へ送ればいいですか。",
        isQuestion: true,
        questionKind: "question",
        answer: "金曜の15時まで。送付前に上長の確認を取る。",
      },
      {
        startMs: 250000,
        text: "金曜の15時が締め切りです。送付前に上長の確認を取ること。",
        isStarred: true,
        importantGroup: "見積もり",
      },
    ],
  },
  {
    title: "先輩との1on1",
    startedOffsetMs: 6 * DAY,
    hour: 16,
    minute: 30,
    durationMs: 25 * MIN,
    blocks: [
      { startMs: 0, text: "今日は仕事の進め方と、わからないところの確認です。" },
      {
        startMs: 50000,
        text: "議事録テンプレートは、どこにありますか。",
        isQuestion: true,
        questionKind: "question",
        answer: "共有フォルダの「テンプレ」にあります。",
      },
      { startMs: 120000, text: "来週の面談までに、先週のメモを整理しておく", isTodo: true },
      {
        startMs: 180000,
        text: "わからないことはその場でメモして、あとからまとめて聞くとよい。",
        isStarred: true,
        importantGroup: "進め方",
      },
      { kind: "note", startMs: 210000, text: "聞き方のコツ：結論から話す。" },
    ],
  },
  {
    title: "情報セキュリティ勉強会",
    startedOffsetMs: 9 * DAY,
    hour: 13,
    minute: 0,
    durationMs: 40 * MIN,
    blocks: [
      { startMs: 0, text: "勉強会のテーマは、フィッシングと端末の取り扱いです。" },
      {
        startMs: 60000,
        text: "フィッシングメールを見つけたら、どこに報告しますか。",
        isQuestion: true,
        questionKind: "question",
        answer: "情報システム部の窓口へ。自分ではリンクを開かない。",
      },
      { startMs: 120000, text: "研修資料を共有フォルダへアーカイブする", isTodo: true, todoDone: true },
      { startMs: 180000, text: "自分のアカウントで2段階認証を8月30日までに設定する", isTodo: true },
      {
        startMs: 240000,
        text: "パスワードマネージャの導入が推奨されています。",
        isStarred: true,
        importantGroup: "パスワード",
      },
      {
        startMs: 300000,
        text: "社用スマホを紛失したときは、まず何をすればいいですか。",
        isQuestion: true,
        questionKind: "question",
      },
    ],
  },
  {
    title: "コンプライアンス研修",
    startedOffsetMs: 13 * DAY,
    hour: 10,
    minute: 0,
    durationMs: 50 * MIN,
    blocks: [
      { startMs: 0, text: "個人情報の取り扱いと、持ち出しのルールを確認します。" },
      {
        startMs: 40000,
        text: "顧客の個人情報は、業務に必要な範囲だけ扱うこと。",
        isStarred: true,
        importantGroup: "個人情報",
      },
      {
        startMs: 90000,
        text: "個人情報をUSBに入れて持ち帰ってよいですか。",
        isQuestion: true,
        questionKind: "question",
        answer: "禁止です。必要な場合は上長と情シスの許可が必要です。",
      },
      { startMs: 150000, text: "受講確認シートを本日中に提出する", isTodo: true, todoDone: true },
      { startMs: 200000, text: "機密文書の廃棄手順をマニュアルで確認する", isTodo: true },
      { kind: "note", startMs: 240000, text: "机の上に資料を出したまま席を外さない。" },
    ],
  },
];

const EN_SESSIONS: SessionSeed[] = [
  {
    title: "New-hire security training",
    startedOffsetMs: 1 * DAY,
    hour: 10,
    minute: 41,
    durationMs: 45 * MIN,
    blocks: [
      {
        startMs: 2000,
        text: "Today I'll explain new-hire training. First, let's review the overall schedule.",
      },
      {
        startMs: 11000,
        text: "Do not reuse passwords. Always follow company policy.",
        isStarred: true,
        importantGroup: "Passwords",
        summaryNote: "12+ characters. No reuse.",
      },
      { startMs: 18000, text: "Next, the security policy." },
      {
        startMs: 52000,
        text: "Don't open unexpected email attachments, even if the sender looks internal.",
        isStarred: true,
        importantGroup: "Email",
      },
      { startMs: 95000, text: "Next, how to protect your account." },
      { startMs: 125000, text: "Set up two-factor authentication by August 30", isTodo: true },
      {
        startMs: 155000,
        text: "Does zero trust mean we verify every time, even on the company network?",
        isQuestion: true,
        questionKind: "question",
        answer: "Yes. Don't trust the location. Verify on every access.",
      },
      { kind: "note", startMs: 210000, text: "Next session is a hands-on exercise. Try the settings on your own device." },
      { startMs: 480000, text: "We'll now start the hands-on exercise. Materials are on the portal." },
      { startMs: 510000, text: "Submit the exercise report by August 30", isTodo: true },
      {
        startMs: 540000,
        text: "Where can I check the evaluation criteria for the exercise?",
        isQuestion: true,
        questionKind: "question",
      },
      {
        startMs: 570000,
        text: "The passing score is 80. It's listed on the training page of the portal.",
        isStarred: true,
        importantGroup: "Exercises",
      },
    ],
  },
  {
    title: "Morning standup",
    startedOffsetMs: 2 * DAY,
    hour: 9,
    minute: 0,
    durationMs: 12 * MIN,
    blocks: [
      { startMs: 0, text: "Let's start this week's standup. Please share what you're doing today." },
      { startMs: 40000, text: "Update the daily report template to the new format today", isTodo: true },
      {
        startMs: 80000,
        text: "Which channel should we post this week's goals in?",
        isQuestion: true,
        questionKind: "question",
      },
      {
        startMs: 110000,
        text: "Call customers back the same day. Don't leave it overnight.",
        isStarred: true,
        importantGroup: "Follow-up",
      },
    ],
  },
  {
    title: "Weekly sales meeting",
    startedOffsetMs: 4 * DAY,
    hour: 14,
    minute: 0,
    durationMs: 32 * MIN,
    blocks: [
      { startMs: 0, text: "Let's start the weekly sales meeting. The quote to the client is still open." },
      { startMs: 40000, text: "Share the meeting notes in the team channel", isTodo: true },
      { startMs: 90000, text: "Book a conference room for next Tuesday", isTodo: true, todoDone: true },
      {
        startMs: 150000,
        text: "Do we check credit limits before or after sending a quote?",
        isQuestion: true,
        questionKind: "question",
      },
      {
        startMs: 210000,
        text: "When do we need to send this quote to the client?",
        isQuestion: true,
        questionKind: "question",
        answer: "Friday at 3pm. Get manager approval before sending.",
      },
      {
        startMs: 250000,
        text: "Friday at 3pm is the deadline. Get manager approval before sending.",
        isStarred: true,
        importantGroup: "Quotes",
      },
    ],
  },
  {
    title: "1-on-1 with mentor",
    startedOffsetMs: 6 * DAY,
    hour: 16,
    minute: 30,
    durationMs: 25 * MIN,
    blocks: [
      { startMs: 0, text: "Today we'll go over how to work, and anything that's still unclear." },
      {
        startMs: 50000,
        text: "Where can I find the meeting-notes template?",
        isQuestion: true,
        questionKind: "question",
        answer: "In the Templates folder on the shared drive.",
      },
      { startMs: 120000, text: "Organize last week's notes before next week's 1-on-1", isTodo: true },
      {
        startMs: 180000,
        text: "Write down questions as they come up, then ask them together later.",
        isStarred: true,
        importantGroup: "How we work",
      },
      { kind: "note", startMs: 210000, text: "Tip: lead with the conclusion." },
    ],
  },
  {
    title: "Information security workshop",
    startedOffsetMs: 9 * DAY,
    hour: 13,
    minute: 0,
    durationMs: 40 * MIN,
    blocks: [
      { startMs: 0, text: "Today's workshop covers phishing and how we handle devices." },
      {
        startMs: 60000,
        text: "Where do I report a phishing email if I find one?",
        isQuestion: true,
        questionKind: "question",
        answer: "IT support. Don't open the link yourself.",
      },
      { startMs: 120000, text: "Archive the training materials in the shared folder", isTodo: true, todoDone: true },
      { startMs: 180000, text: "Set up two-factor authentication on your account by August 30", isTodo: true },
      {
        startMs: 240000,
        text: "Using a password manager is recommended.",
        isStarred: true,
        importantGroup: "Passwords",
      },
      {
        startMs: 300000,
        text: "If I lose my work phone, what should I do first?",
        isQuestion: true,
        questionKind: "question",
      },
    ],
  },
  {
    title: "Compliance training",
    startedOffsetMs: 13 * DAY,
    hour: 10,
    minute: 0,
    durationMs: 50 * MIN,
    blocks: [
      { startMs: 0, text: "We'll review how to handle personal data and the rules for taking it off-site." },
      {
        startMs: 40000,
        text: "Use customer personal data only for the work that needs it.",
        isStarred: true,
        importantGroup: "Personal data",
      },
      {
        startMs: 90000,
        text: "Can I copy personal data onto a USB drive and take it home?",
        isQuestion: true,
        questionKind: "question",
        answer: "No. You need manager and IT approval if it's ever required.",
      },
      { startMs: 150000, text: "Submit the attendance sheet today", isTodo: true, todoDone: true },
      { startMs: 200000, text: "Check the manual for how to dispose of confidential documents", isTodo: true },
      { kind: "note", startMs: 240000, text: "Don't leave papers on the desk when you step away." },
    ],
  },
];

const LEGACY_SEED_TITLES = [
  "2026/08/21 の研修",
  "営業ミーティング",
  "セキュリティ勉強会",
  "New hire training",
  "Sales meeting",
  "Security workshop",
];

const SEED_TITLES = new Set([...JA_SESSIONS, ...EN_SESSIONS].map((s) => s.title).concat(LEGACY_SEED_TITLES));

function loadSeededIds(): string[] {
  try {
    if (!seedIdsFile.exists) return [];
    const parsed = JSON.parse(seedIdsFile.textSync()) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function saveSeededIds(ids: string[]): void {
  seedIdsFile.create({ overwrite: true });
  seedIdsFile.write(JSON.stringify(ids));
}

async function createSessionWithBlocks(seed: SessionSeed): Promise<string> {
  const startedAt = startedAtFromSeed(seed);
  const session = await sessionsRepo.create({
    id: genId(),
    title: seed.title,
    startedAt,
    durationMs: seed.durationMs,
  });
  for (const blockSeed of seed.blocks) {
    const block = await blocksRepo.create({
      id: genId(),
      sessionId: session.id,
      kind: blockSeed.kind ?? "transcript",
      startMs: blockSeed.startMs,
      text: blockSeed.text ?? null,
      photoUri: null,
      isStarred: blockSeed.isStarred,
      isTodo: blockSeed.isTodo,
      isQuestion: blockSeed.isQuestion,
      questionTerm: blockSeed.answer ?? null,
      questionKind: blockSeed.questionKind,
    });
    if (blockSeed.todoDone) {
      await blocksRepo.toggleTodoDone(block.id);
    }
    if (blockSeed.summaryNote) {
      await blocksRepo.setSummaryNote(block.id, blockSeed.summaryNote);
    }
    if (blockSeed.importantGroup) {
      await blocksRepo.setImportantGroup(block.id, blockSeed.importantGroup);
    }
  }
  return session.id;
}

async function deleteSessionCompletely(sessionId: string): Promise<void> {
  const [blocks, audioFiles] = await Promise.all([
    blocksRepo.listBySessionId(sessionId),
    audioFilesRepo.listBySessionId(sessionId),
  ]);
  await sessionsRepo.deleteById(sessionId);
  await Promise.all([
    ...blocks.filter((b) => b.kind === "photo" && b.photoUri).map((b) => deleteStoredFile(b.photoUri as string)),
    ...audioFiles.map((f) => deleteStoredFile(f.fileUri)),
  ]);
}

export async function seedDevTestData(locale: DevTestDataLocale = "ja"): Promise<void> {
  if (!__DEV__) return;
  const sessions = locale === "en" ? EN_SESSIONS : JA_SESSIONS;
  const ids: string[] = [];
  for (const seed of sessions) {
    ids.push(await createSessionWithBlocks(seed));
  }
  saveSeededIds([...new Set([...loadSeededIds(), ...ids])]);
}

export async function deleteDevTestData(): Promise<number> {
  if (!__DEV__) return 0;
  const tracked = new Set(loadSeededIds());
  const sessions = await sessionsRepo.listAll();
  const ids = new Set<string>();
  for (const id of tracked) ids.add(id);
  for (const session of sessions) {
    if (SEED_TITLES.has(session.title)) ids.add(session.id);
  }

  let deleted = 0;
  for (const id of ids) {
    const exists = sessions.some((s) => s.id === id) || (await sessionsRepo.getById(id));
    if (!exists) continue;
    await deleteSessionCompletely(id);
    deleted += 1;
  }
  saveSeededIds([]);
  return deleted;
}

const HERO_TITLES = new Set(["新人セキュリティ研修", "New-hire security training"]);

async function copyAudioToHero(sourceUri: string, durationMs: number, heroId: string, targetDurationMs: number): Promise<boolean> {
  const src = new File(sourceUri);
  if (!src.exists) return false;
  const audioDir = new Directory(Paths.document, "audio");
  if (!audioDir.exists) audioDir.create({ intermediates: true, idempotent: true });

  let destUri = "";
  let destDurationMs = durationMs > 0 ? durationMs : 1;
  const padded = await padWavToDurationMs(sourceUri, targetDurationMs);
  if (padded) {
    destUri = padded.fileUri;
    destDurationMs = padded.durationMs;
  } else {
    const ext = src.extension?.startsWith(".") ? src.extension : ".wav";
    const dest = new File(audioDir, `${heroId}_${Date.now()}${ext}`);
    try {
      await src.copy(dest);
    } catch (e) {
      console.warn("[Dev] 音声ファイルのコピーに失敗しました", sourceUri, e);
      return false;
    }
    if (!dest.exists) return false;
    destUri = dest.uri;
  }

  await audioFilesRepo.replaceWithMergedFile(heroId, {
    id: genId(),
    fileUri: destUri,
    durationMs: destDurationMs,
  });
  return true;
}

// シードの研修ノートには音声が無い。実録音のファイル(DBまたはDocuments/audio)を載せる
export async function attachLatestAudioToHeroNotes(): Promise<number> {
  if (!__DEV__) return 0;
  const sessions = await sessionsRepo.listAll();
  const heroes = sessions.filter((s) => HERO_TITLES.has(s.title));
  if (heroes.length === 0) return 0;
  const heroIds = new Set(heroes.map((h) => h.id));
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const audios = await audioFilesRepo.listAll();

  const dbCandidates = [...audios]
    .filter((a) => !heroIds.has(a.sessionId))
    .sort(
      (a, b) =>
        (byId.get(b.sessionId)?.updatedAt ?? 0) - (byId.get(a.sessionId)?.updatedAt ?? 0)
    );
  const diskCandidates = listAudioDirectoryEntries()
    .filter((entry) => !audios.some((a) => heroIds.has(a.sessionId) && a.fileUri === entry.uri))
    .sort((a, b) => b.lastModified - a.lastModified);

  const sources: { uri: string; durationMs: number; sessionId?: string }[] = [
    ...dbCandidates.map((a) => ({ uri: a.fileUri, durationMs: a.durationMs, sessionId: a.sessionId })),
    ...diskCandidates.map((e) => ({ uri: e.uri, durationMs: 0 })),
    ...audios.map((a) => ({ uri: a.fileUri, durationMs: a.durationMs, sessionId: a.sessionId })),
  ];

  let attached = 0;
  for (const hero of heroes) {
    let ok = false;
    for (const source of sources) {
      if (await copyAudioToHero(source.uri, source.durationMs, hero.id, hero.durationMs || 45 * MIN)) {
        ok = true;
        break;
      }
    }
    if (ok) attached += 1;
  }
  return attached;
}
