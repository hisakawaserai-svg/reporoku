import { useState, useRef, useEffect } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  AppState,
  AppStateStatus,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import { genId } from "../utils/id";
import { getAudioDirectoryUri, persistPhotoFile } from "../utils/files";
import { getDefaultSectionGapMs, getSectionGroupingEnabled } from "../utils/settings";
import type { RootStackParamList } from "../navigation/RootNavigator";

type Block = {
  id?: string;
  ms: number;
  // 発話終了の実測値(音声認識がfinal結果を返した時刻)。セクション分けの間隔計算で
  // 文字数からの推定より正確な値として使う(長い発言ほど推定が外れやすいため)
  endMs?: number;
  text: string;
  kind: "text" | "sys";
  isStarred?: boolean;
  isTodo?: boolean;
  isQuestion?: boolean;
};

const KEEP_AWAKE_TAG = "record-screen";
const LIVE_FOCUS_BAR_COUNT = 5;

type MarkKey = "star" | "todo" | "question" | "photo" | "memo";

const MARK_TILES: {
  key: MarkKey;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  border: string;
  bg: string;
  tint: string;
}[] = [
  { key: "star", icon: "star", label: "重要", border: "#f3cf7c", bg: "#fff8e8", tint: "#c98a00" },
  { key: "todo", icon: "checkmark-circle", label: "ToDo", border: "#9adcab", bg: "#eefbf1", tint: "#2fa84f" },
  { key: "question", icon: "help-circle", label: "質問", border: "#c9b3f5", bg: "#f5f0ff", tint: "#7c4dff" },
  { key: "photo", icon: "camera", label: "撮影", border: "#d3d3d9", bg: "#f7f7f9", tint: "#57575c" },
  { key: "memo", icon: "create", label: "メモ", border: "#d3d3d9", bg: "#f7f7f9", tint: "#57575c" },
];

// タイムラインのセクション分けの閾値(ms)。ノート詳細画面と同じ考え方
// (前のブロックの推定終了時刻から次のブロックのstart(ms)までの「間」で判定する)。
// セクションの閾値自体はセッション(録音)ごとにsessions.section_gap_msとして持つため、
// ここには「同じ段落とみなすか」の閾値だけを残す。録音画面自体にスライダーは置かず、
// 調整はノート詳細画面に一本化しているため、この画面では開始時に読み込んだ値を録音中ずっと使う
const PARAGRAPH_GAP_MS = 1500; // これ未満: 同じ段落として行間を詰める
const MS_PER_CHAR = 150; // 1文字あたりの推定発話時間(ms)。ノート詳細画面と同じ概算値

// 発言(text)ブロックの推定継続時間。sysメッセージ(エラー等)は瞬間的なものとして0とする。
// endMs(音声認識のfinal結果が返ってきた実測終了時刻)があればそちらを使うため、
// これは古いデータなどendMsが無い場合のフォールバックとしてのみ使われる
function estimateBlockDurationMs(block: Block): number {
  if (block.kind !== "text" || !block.text) return 0;
  return block.text.length * MS_PER_CHAR;
}

// 前のブロックの終了時刻から次のブロックの開始時刻までの「間」。
// 長い発言ほど文字数からの推定が外れやすいため、実測のendMsがあれば必ずそちらを優先する
function gapMsBetween(prev: Block, next: Block): number {
  const prevEndMs = prev.endMs ?? prev.ms + estimateBlockDurationMs(prev);
  return Math.max(0, next.ms - prevEndMs);
}

type RecordRowSpacing = "paragraph" | "line";
function recordRowSpacingFor(prev: Block | undefined, block: Block): RecordRowSpacing {
  if (!prev) return "line";
  return gapMsBetween(prev, block) < PARAGRAPH_GAP_MS ? "paragraph" : "line";
}

type RecordSection = { key: string; blocks: Block[] };

// ノート詳細画面のgroupByGapと同じロジック(計算式は共通)でブロックをセクションに分ける
function groupBlocksIntoSections(blocks: Block[], sectionGapMs: number): RecordSection[] {
  const sections: RecordSection[] = [];
  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    const key = block.id ?? `sys-${i}`;
    if (!prev || gapMsBetween(prev, block) >= sectionGapMs) {
      sections.push({ key, blocks: [block] });
    } else {
      sections[sections.length - 1].blocks.push(block);
    }
  });
  return sections;
}

type RecordIconBadge = { key: string; icon: keyof typeof Ionicons.glyphMap; color: string };

// ★・📝・❓が同じ発言に複数付いている場合、色を1色に混ぜて代表させるのではなく、
// 該当するアイコンをすべて横に並べたバッジとして返す(ノート詳細画面のactiveBadgesと同じ考え方)
function recordBlockBadges(b: Block): RecordIconBadge[] {
  const badges: RecordIconBadge[] = [];
  if (b.isStarred) badges.push({ key: "star", icon: "star", color: "#c98a00" });
  if (b.isTodo) badges.push({ key: "todo", icon: "checkmark-circle", color: "#2fa84f" });
  if (b.isQuestion) badges.push({ key: "question", icon: "help-circle", color: "#7c4dff" });
  return badges;
}

// App.tsx にあった録音・文字起こしの検証コードをそのまま移植したもの。
// ロジックは変更していない。見た目(スタイル)のみ Claude Design 案(3a)に合わせて調整。
export default function RecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const isPausingRef = useRef(false);       // 意図的な一時停止によるstopか(自動再開・完全終了と区別する)
  const contentMsRef = useRef(0);           // 実際に録音された音声の累積時間(セッション全体のタイムライン基準はこれ。再起動・一時停止による空白時間は含まない)
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [interim, setInterim] = useState("");
  const [audioUris, setAudioUris] = useState<string[]>([]);
  const [diag, setDiag] = useState("");
  const [restarts, setRestarts] = useState(0);

  const startedAt = useRef(0);
  const shouldRun = useRef(false);      // ユーザーが「止めたい」のか判別
  const failStreak = useRef(0);         // 無限リトライ防止
  const lastResultAt = useRef(0);
  const segStart = useRef<number | null>(null);
  const [leadSec, setLeadSec] = useState(1.2);

  const isRecognizingRef = useRef(false);            // 現在ネイティブ側の音声認識セッションが動いているか(audiostart〜end間)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // DB連携用の状態
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef(0);   // セッション全体の開始時刻(音声認識の再起動では変わらない)
  // このセッションのセクション区切り閾値(ms)。開始時に設定画面のデフォルト値を読み込んで固定する。
  // 録音画面自体には調整UIを置かない(微調整はノート詳細画面のスライダーに一本化)ため、録音中は変わらない
  const sectionGapMsRef = useRef(5000);
  const lastBlockIdRef = useRef<string | null>(null); // 直近確定した文字起こしブロックのID
  const audioSeqRef = useRef(0);           // 音声ファイルの連番(再起動のたびにインクリメント)

  // ❓は「質問」(あとで聞きたいこと)か「用語」(わからなかった言葉)かを最初に選ばせる。
  // questionModalVisible/questionTermInputは「用語」を選んだ場合の単語入力ステップとして再利用する
  const [questionChoiceVisible, setQuestionChoiceVisible] = useState(false);
  const [questionModalVisible, setQuestionModalVisible] = useState(false);
  const [questionTermInput, setQuestionTermInput] = useState("");
  // ❓の対象ブロック。短押し時はlastBlockIdRef、タイル長押しのピッカーからは選択したブロックが入る
  const questionTargetBlockIdRef = useRef<string | null>(null);
  const [memoModalVisible, setMemoModalVisible] = useState(false);
  const [memoInput, setMemoInput] = useState("");

  // ★/📝/❓タイルを長押しした時の「ログの発言をタップして選ぶ」モード。
  // 別モーダルは出さず、画面内に既に見えているタイムラインをそのまま選択先にする
  const [markSelectMode, setMarkSelectMode] = useState<MarkKey | null>(null);

  // タイムライン上でブロックを長押しして開く「結合/分割/マーク」メニュー相当(録音中は結合/分割は無し)。
  // ノート詳細画面のものと同様の見た目・挙動にするため、対象ブロックの実測座標を保持する
  const [menuAnchor, setMenuAnchor] = useState<{
    blockId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const blockRowRefs = useRef<Map<string, View>>(new Map());
  const menuHighlightScale = useRef(new Animated.Value(1)).current;
  // 長押しメニューからの「テキスト編集」で編集中のブロック
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // 長押しで新着への自動スクロールを一時停止しているか。「↓ 新着N件」バッジをタップするまで解除しない
  const [scrollPaused, setScrollPaused] = useState(false);
  // 一時停止を始めた時点の発言ブロック数。バッジの「新着N件」はここからの増分
  const pauseBaselineCountRef = useRef(0);

  // セッション全体(録音済み音声の累積時間)での経過ms。再起動をまたいでも連続した値になる
  const sessionElapsedMs = () => contentMsRef.current + Math.max(0, Date.now() - startedAt.current);

  const push = (text: string, kind: Block["kind"] = "text", ms?: number, id?: string, endMs?: number) =>
    setBlocks((p) => [...p, { id, ms: ms ?? sessionElapsedMs(), endMs, text, kind }]);

  const persistTranscriptBlock = (id: string, text: string, startMs: number, endMs: number) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    lastBlockIdRef.current = id;
    blocksRepo
      .create({ id, sessionId, kind: "transcript", startMs, endMs, text })
      .catch((e) => console.warn("[DB] transcriptブロックの保存に失敗しました", e));
  };

  const finalizeSessionDuration = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const durationMs = Math.max(0, Date.now() - sessionStartedAtRef.current);
    sessionsRepo
      .updateDuration(sessionId, durationMs)
      .catch((e) => console.warn("[DB] セッション長さの更新に失敗しました", e));
  };

  // ユーザーが明示的に「終了」した時だけ、保存完了画面に遷移する(エラーによる強制中断時は遷移しない)
  const goToRecordComplete = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    navigation.navigate("RecordComplete", { noteId: sessionId });
  };

  // 終了後、次の録音に備えて画面をまっさらな状態に戻す(保存結果は録音完了画面で確認できるため)
  const clearScreenState = () => {
    setBlocks([]);
    setAudioUris([]);
    setInterim("");
  };

  const toggleStarOnLastBlock = () => {
    const id = lastBlockIdRef.current;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isStarred: !b.isStarred } : b)));
    blocksRepo.toggleStar(id).catch((e) => console.warn("[DB] スター切替に失敗しました", e));
  };

  const toggleTodoOnLastBlock = () => {
    const id = lastBlockIdRef.current;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isTodo: !b.isTodo } : b)));
    blocksRepo.toggleTodo(id).catch((e) => console.warn("[DB] ToDo切替に失敗しました", e));
  };

  // 2文字以上のカタカナ連続(長音符ー含む)のうち最も長いものを、用語入力欄の初期値候補として返す
  const extractLongestKatakana = (text: string | null | undefined): string => {
    if (!text) return "";
    const matches = text.match(/[ァ-ヶー]{2,}/g);
    if (!matches || matches.length === 0) return "";
    return matches.reduce((longest, cur) => (cur.length > longest.length ? cur : longest), "");
  };

  // ❓の2択(質問/用語)。「質問」は追加入力なしで即確定、「用語」は単語入力ステップに進む
  const chooseQuestionKind = (kind: "question" | "term") => {
    setQuestionChoiceVisible(false);
    const id = questionTargetBlockIdRef.current;
    if (kind === "question") {
      if (!id) return;
      blocksRepo
        .setQuestion(id, true, null, "question")
        .catch((e) => console.warn("[DB] 質問の保存に失敗しました", e));
      return;
    }
    const target = blocks.find((b) => b.id === id);
    setQuestionTermInput(extractLongestKatakana(target?.text));
    setQuestionModalVisible(true);
  };

  const confirmQuestion = () => {
    const id = questionTargetBlockIdRef.current;
    const term = questionTermInput.trim();
    setQuestionModalVisible(false);
    setQuestionTermInput("");
    if (!id) return;
    blocksRepo
      .setQuestion(id, true, term || null, "term")
      .catch((e) => console.warn("[DB] 質問の保存に失敗しました", e));
  };

  const confirmMemo = () => {
    const sessionId = sessionIdRef.current;
    const text = memoInput.trim();
    setMemoModalVisible(false);
    setMemoInput("");
    if (!sessionId || !text) return;
    const startMs = sessionElapsedMs();
    blocksRepo
      .create({ id: genId(), sessionId, kind: "note", startMs, text })
      .catch((e) => console.warn("[DB] メモの保存に失敗しました", e));
  };

  const handlePhotoCapture = async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        push("[カメラ権限が拒否されました]", "sys");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const startMs = sessionElapsedMs();

      // cache URIのままだとOSに削除される恐れがあるため、documentDirectory配下へコピーする
      let photoUri = result.assets[0].uri;
      try {
        photoUri = await persistPhotoFile(photoUri, sessionId);
      } catch (copyErr) {
        console.warn("[FS] 写真の永続保存に失敗しました。cacheのURIのまま記録します", copyErr);
      }

      await blocksRepo.create({
        id: genId(),
        sessionId,
        kind: "photo",
        startMs,
        photoUri,
      });
    } catch (e) {
      console.warn("[DB] 写真ブロックの保存に失敗しました", e);
    }
  };

  // 長押しで「結合/分割/マーク」メニューを開く。録音中は結合・分割は不要なため省いている。
  // 開いた瞬間、まだ一時停止していなければ新着自動スクロールを止め、その時点の件数を基準点にする
  const openBlockMenu = (block: Block) => {
    if (!block.id || editingBlockId) return;
    if (!scrollPaused) {
      pauseBaselineCountRef.current = blocks.filter((b) => b.kind === "text").length;
      setScrollPaused(true);
    }
    const node = blockRowRefs.current.get(block.id);
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ blockId: block.id!, x, y, width, height });
      menuHighlightScale.setValue(1);
      Animated.spring(menuHighlightScale, {
        toValue: 1.08,
        friction: 4,
        tension: 160,
        useNativeDriver: true,
      }).start();
    });
  };

  const closeBlockMenu = () => setMenuAnchor(null);

  // 「↓ 新着N件」バッジをタップしたときの再開。自動スクロールを再開し、最新まで一度ジャンプする
  const resumeAutoScroll = () => {
    setScrollPaused(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  const toggleBlockStar = (block: Block) => {
    setMenuAnchor(null);
    const id = block.id;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isStarred: !b.isStarred } : b)));
    blocksRepo.toggleStar(id).catch((e) => console.warn("[DB] スター切替に失敗しました", e));
  };

  const toggleBlockTodo = (block: Block) => {
    setMenuAnchor(null);
    const id = block.id;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isTodo: !b.isTodo } : b)));
    blocksRepo.toggleTodo(id).catch((e) => console.warn("[DB] ToDo切替に失敗しました", e));
  };

  const toggleBlockQuestion = (block: Block) => {
    setMenuAnchor(null);
    const id = block.id;
    if (!id) return;
    const next = !block.isQuestion;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isQuestion: next } : b)));
    // このトグルは単純なON/OFFのため、質問集(question)側の対象として扱う
    // (用語のような追加入力は求めないため。question_kindが未設定のままだと
    // 質問集・用語集のどちらにも表示されなくなってしまう)
    blocksRepo
      .setQuestion(id, next, null, next ? "question" : null)
      .catch((e) => console.warn("[DB] 質問マークの切替に失敗しました", e));
  };

  const startEditingBlock = (block: Block) => {
    setMenuAnchor(null);
    if (!block.id) return;
    setEditingBlockId(block.id);
    setEditDraft(block.text);
  };

  const cancelBlockEdit = () => setEditingBlockId(null);

  const commitBlockEdit = () => {
    const id = editingBlockId;
    setEditingBlockId(null);
    if (!id) return;
    const trimmed = editDraft.trim();
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, text: trimmed } : b)));
    blocksRepo.update(id, trimmed).catch((e) => console.warn("[DB] ブロックの更新に失敗しました", e));
  };

  const confirmDeleteBlock = (block: Block) => {
    setMenuAnchor(null);
    const id = block.id;
    if (!id) return;
    Alert.alert("このブロックを削除しますか？", "元に戻せません。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          setBlocks((p) => p.filter((b) => b.id !== id));
          blocksRepo.remove(id).catch((e) => console.warn("[DB] ブロックの削除に失敗しました", e));
        },
      },
    ]);
  };

  // 起動時に端末の能力を調べる
  useEffect(() => {
    (async () => {
      try {
        const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
        const rec = ExpoSpeechRecognitionModule.supportsRecording();
        const loc = await ExpoSpeechRecognitionModule.getSupportedLocales({});
        const hasJa = loc.locales?.some((l: string) => l.toLowerCase().startsWith("ja"));
        const jaInstalled = loc.installedLocales?.some((l: string) =>
          l.toLowerCase().startsWith("ja")
        );
        setDiag(
          `onDevice: ${onDevice} / recording: ${rec}\n` +
            `ja 対応: ${hasJa} / ja DL済: ${jaInstalled}\n` +
            `installed: ${JSON.stringify(loc.installedLocales)}`
        );
      } catch (e: any) {
        setDiag(`診断エラー: ${e.message}`);
      }
    })();
  }, []);

  const prevEnd = useRef(0);   // 前の発言が終わった時刻

  useSpeechRecognitionEvent("result", (e) => {
    const text = (e.results[0]?.transcript ?? "").trim();
    const now = sessionElapsedMs();

    lastResultAt.current = Date.now();
    failStreak.current = 0;

    if (e.isFinal) {
      if (text) {
        // 開始時刻の候補：interim が来ていればそれ、なければ「前の発言の終わり」
        const start = segStart.current ?? prevEnd.current;
        const id = genId();
        // nowはfinal結果が返ってきた実際の時刻(=この発言の実測終了時刻)。文字数からの
        // 推定より正確なので、そのままセクション分けの間隔計算に使う
        push(text, "text", start, id, now);
        persistTranscriptBlock(id, text, start, now);
        prevEnd.current = now;      // 今の終わりを、次の発言の開始点にする
        segStart.current = null;    // 空文字finalでリセットすると、同じ発話が続いている場合に開始時刻がズレるため、ここでのみリセット
        setInterim("");             // 確定した発話をタイムラインに反映したので、進行中表示をクリアする
      }
      // 空文字でのfinal(他アプリへの切替などによる音声セッション割り込みでセグメントが
      // 強制終了した際に発生しうる)ではクリアしない。ここでクリアすると、実際にはまだ
      // 発話内容自体は失われていないのに、ライブフォーカスの表示だけが一瞬空白になってしまうため
      return;
    }

    if (!text) return;
    if (segStart.current === null) segStart.current = now;
    setInterim(text);
  });

  useSpeechRecognitionEvent("audiostart", () => {
    startedAt.current = Date.now(); // このセグメント(音声ファイル)の0秒を表す実時刻
    segStart.current = null; // 新しい認識セッションでは未確定の発話区間をリセットする(prevEndはセッション全体の時系列を保つため、ここではリセットしない)
    isRecognizingRef.current = true;
  });

  useSpeechRecognitionEvent("audioend", (e) => {
    if (e.uri) setAudioUris((p) => [...p, e.uri!]);
    const sessionId = sessionIdRef.current;
    if (e.uri && sessionId) {
      const segmentStartedAt = startedAt.current;
      const durationMs = Math.max(0, Date.now() - segmentStartedAt);
      // 「これまでに実際に録音された音声の累積時間」を開始位置にする(再起動の空白時間は含めない)
      const offsetMs = contentMsRef.current;
      contentMsRef.current += durationMs;
      const seq = audioSeqRef.current++;
      // TODO: offset_msの連続性を実機で検証するための一時ログ。確認が終わったら削除する
      console.log(`[audioend] seq=${seq} offsetMs=${offsetMs} durationMs=${durationMs} nextOffsetMs=${offsetMs + durationMs}`);
      audioFilesRepo
        .create({ id: genId(), sessionId, fileUri: e.uri, seq, offsetMs, durationMs })
        .catch((err) => console.warn("[DB] 音声ファイルの保存に失敗しました", err));
    }
  });

  useSpeechRecognitionEvent("error", (e) => {
    // no-speech は無音が続いた際に毎回発生する想定内のエラーで、
    // end イベント側で自動再開されるため画面には表示しない(ノイズになるだけのため)
    if (e.error === "no-speech") return;
    push(`[ERROR] ${e.error} — ${e.message}`, "sys");
  });

  // ここが肝:終了したら、止めたいわけでなければ即座に再開
  useSpeechRecognitionEvent("end", () => {
    isRecognizingRef.current = false;

    if (isPausingRef.current) {
      // 一時停止による停止。セッションは終了させず、次の「再開」を待つ
      isPausingRef.current = false;
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      return;
    }
    if (!shouldRun.current) {
      // 録音用のオーディオセッション(playAndRecord)を解放し、再生時にBluetoothが切れないようにする
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      setRunning(false);
      finalizeSessionDuration();
      goToRecordComplete();
      clearScreenState();
      return;
    }
    if (appStateRef.current !== "active") {
      // バックグラウンド中(他アプリへの切替による音声セッション割り込みなど)のendは、
      // すぐに再起動しても失敗するだけなので、ここではリトライせず
      // フォアグラウンド復帰時にまとめて再開する(AppStateの変化を監視するuseEffect側で処理)
      return;
    }
    failStreak.current += 1;
    if (failStreak.current > 8) {
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      push("[連続失敗のため中断。上のERRORを確認してください]", "sys");
      shouldRun.current = false;
      setRunning(false);
      finalizeSessionDuration();
      return;
    }
    setRestarts((n) => n + 1);
    setTimeout(() => {
      if (shouldRun.current) begin();
    }, 150);
  });

  const useExternalicMic = false; // 外部マイクを使う場合は true にする

  const begin = () => {
    // cache配下(既定値)だとOSに自動削除される恐れがあるため、documentDirectory配下を明示する
    let audioOutputDirectory: string | undefined;
    try {
      audioOutputDirectory = getAudioDirectoryUri();
    } catch (e) {
      console.warn("[FS] 音声保存ディレクトリの準備に失敗しました。既定のcacheに保存されます", e);
    }

    ExpoSpeechRecognitionModule.start({
      lang: "ja-JP",
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      recordingOptions: { persist: true, outputDirectory: audioOutputDirectory },
      iosCategory: {
        category: "playAndRecord",
        categoryOptions: useExternalicMic ? ["defaultToSpeaker", "allowBluetooth"] : ["defaultToSpeaker"],
        mode: "default",          // ← measurement から変更。AGCが効くようになる
      },
      iosTaskHint: "dictation",    // ← 連続した話し言葉向けのヒント
    });
  };

  const start = async () => {
    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!mic.granted) {
      push("[マイク権限が拒否されました]", "sys");
      return;
    }
    startedAt.current = Date.now();
    sessionStartedAtRef.current = startedAt.current;
    lastResultAt.current = Date.now();
    failStreak.current = 0;
    shouldRun.current = true;
    setBlocks([]);
    setAudioUris([]);
    setRestarts(0);
    setRunning(true);

    const sessionId = genId();
    sessionIdRef.current = sessionId;
    lastBlockIdRef.current = null;
    audioSeqRef.current = 0;
    contentMsRef.current = 0;
    sectionGapMsRef.current = getDefaultSectionGapMs();
    sessionsRepo
      .create({
        id: sessionId,
        title: "",
        startedAt: sessionStartedAtRef.current,
        sectionGapMs: sectionGapMsRef.current,
      })
      .catch((e) => console.warn("[DB] セッションの作成に失敗しました", e));

    begin();
  };

  const stop = () => {
    shouldRun.current = false;
    ExpoSpeechRecognitionModule.stop();
  };

  const pause = () => {
    isPausingRef.current = true;
    shouldRun.current = false; // 自動再開を止める
    // 累積時間の加算は audioend ハンドラで実測 durationMs をもとに行われるため、ここでは何もしない
    ExpoSpeechRecognitionModule.stop();
    setPaused(true);
  };

  const resume = () => {
    shouldRun.current = true;
    setPaused(false);
    begin(); // audiostartでstartedAt.currentが更新され、経過時間はcontentMsRefからの続きとして計測される
  };

  // 一時停止中は音声認識が既に止まっているため、endイベントを待たずにここで終了処理を行う
  const endSession = () => {
    if (paused) {
      shouldRun.current = false;
      setPaused(false);
      setRunning(false);
      finalizeSessionDuration();
      goToRecordComplete();
      clearScreenState();
      return;
    }
    stop();
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // 他アプリへの切替や画面ロックなどでフォアグラウンド/バックグラウンドが切り替わったときの処理。
  // 画面ロックは通常ネイティブ側の音声セッションを止めないため、ここでは能動的にstopしない
  // (endイベント側で isRecognizingRef を見て、実際に止まっていた場合だけ再開する)。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const wasActive = appStateRef.current === "active";
      appStateRef.current = nextState;
      if (
        nextState === "active" &&
        !wasActive &&
        shouldRun.current &&
        !isPausingRef.current &&
        !isRecognizingRef.current
      ) {
        // フォアグラウンド復帰時点で認識が止まっていた(=バックグラウンド中の割り込みで
        // 実際に停止していた)場合のみ、失敗カウントをリセットして明示的に再開する
        failStreak.current = 0;
        begin();
      }
    });
    return () => sub.remove();
  }, []);

  // debug
  const rawLog = useRef<string[]>([]);
  const [showLog, setShowLog] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  // ここから下は見た目専用の状態(録音・認識ロジックには関与しない)

  // この画面が表示されている間だけ画面スリープを防止する
  // (タブ切り替えではアンマウントされないため、フォーカス状態で明示的に切り替える)
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [isFocused]);

  // 設定画面の「セクション分けを表示する」トグル。設定画面で切り替えた後、
  // この画面に戻ってきた時に反映されるよう、フォーカスの都度読み直す
  const [sectionGroupingEnabled, setSectionGroupingEnabledState] = useState(getSectionGroupingEnabled);
  useEffect(() => {
    if (isFocused) setSectionGroupingEnabledState(getSectionGroupingEnabled());
  }, [isFocused]);

  // 経過時間の表示用ティッカー(一時停止中は加算を止め、再開後は続きから計測する)
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running || paused) return;
    const id = setInterval(() => setElapsedMs(sessionElapsedMs()), 200);
    return () => clearInterval(id);
  }, [running, paused]);
  useEffect(() => {
    if (!running) {
      setElapsedMs(0);
    }
  }, [running]);

  // ★/📝/❓/📷/✏️ タップ時の見た目のフィードバック + 実際のDB操作
  const [activeMark, setActiveMark] = useState<MarkKey | null>(null);
  const handleMarkPress = (key: MarkKey) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setActiveMark(key);
    setTimeout(() => setActiveMark((cur) => (cur === key ? null : cur)), 350);

    switch (key) {
      case "star":
        toggleStarOnLastBlock();
        break;
      case "todo":
        toggleTodoOnLastBlock();
        break;
      case "question":
        questionTargetBlockIdRef.current = lastBlockIdRef.current;
        setQuestionChoiceVisible(true);
        break;
      case "photo":
        handlePhotoCapture();
        break;
      case "memo":
        setMemoModalVisible(true);
        break;
    }
  };

  // ★/📝/❓タイル自体を長押しした時、「ログの発言をタップして選ぶ」モードに入る。
  // タイムライン上の文字を直接長押しするメニューとは別の入口(こちらは「今どのブロックか
  // 見なくても押せる」タイル操作の延長)だが、選択自体は既に見えているログをそのまま使う
  const startMarkSelectMode = (key: MarkKey) => {
    if (key !== "star" && key !== "todo" && key !== "question") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMarkSelectMode(key);
    // 選び終わるまでログが自動で下にスクロールしてしまうと対象を見失うため一時停止する
    if (!scrollPaused) {
      pauseBaselineCountRef.current = blocks.filter((b) => b.kind === "text").length;
      setScrollPaused(true);
    }
  };

  const cancelMarkSelectMode = () => setMarkSelectMode(null);

  const pickBlockForMark = (block: Block) => {
    if (markSelectMode === "star") {
      toggleBlockStar(block);
    } else if (markSelectMode === "todo") {
      toggleBlockTodo(block);
    } else if (markSelectMode === "question") {
      questionTargetBlockIdRef.current = block.id ?? null;
      setQuestionChoiceVisible(true);
    }
    setMarkSelectMode(null);
  };

  // 文字起こしリストの自動スクロール
  const scrollRef = useRef<ScrollView>(null);

  // ノート詳細画面と同じグループ化ロジックでセクション分けする。録音中は折りたたみを
  // 一切行わない(常に全セクション展開)ため、ノート詳細画面と違って開閉状態は持たない。
  // オフの場合は計算自体を行わず、全ブロックを1つの「セクション」として扱いフラットな
  // 時系列リストにする
  const sections = sectionGroupingEnabled
    ? groupBlocksIntoSections(blocks, sectionGapMsRef.current)
    : [{ key: "flat", blocks }];

  // 長押しメニューの対象ブロックと、メニュー項目
  const menuBlockId = menuAnchor?.blockId ?? null;
  const menuBlock = menuBlockId ? blocks.find((b) => b.id === menuBlockId) ?? null : null;

  type IconName = keyof typeof Ionicons.glyphMap;
  type MenuItem = { key: string; label: string; icon: IconName; color: string; onPress: () => void };
  type AttrButton = {
    key: string;
    icon: IconName;
    active: boolean;
    activeColor: string;
    inactiveBg: string;
    onPress: () => void;
  };

  const attributeButtons: AttrButton[] = menuBlock
    ? [
        {
          key: "star",
          icon: "star",
          active: !!menuBlock.isStarred,
          activeColor: "#d98c00",
          inactiveBg: "#fdf0dc",
          onPress: () => toggleBlockStar(menuBlock),
        },
        {
          key: "todo",
          icon: "checkmark",
          active: !!menuBlock.isTodo,
          activeColor: "#1f9254",
          inactiveBg: "#e0f7e6",
          onPress: () => toggleBlockTodo(menuBlock),
        },
        {
          key: "question",
          icon: "help-circle",
          active: !!menuBlock.isQuestion,
          activeColor: "#7c4dff",
          inactiveBg: "#f2e8fc",
          onPress: () => toggleBlockQuestion(menuBlock),
        },
      ]
    : [];

  const actionItems: MenuItem[] = menuBlock
    ? [
        {
          key: "edit",
          label: "テキスト編集",
          icon: "create-outline",
          color: "#8e8e93",
          onPress: () => startEditingBlock(menuBlock),
        },
        {
          key: "memo",
          label: "メモを追加",
          icon: "document-text-outline",
          color: "#8e8e93",
          onPress: () => {
            setMenuAnchor(null);
            setMemoModalVisible(true);
          },
        },
        {
          key: "photo",
          label: "写真を追加",
          icon: "camera-outline",
          color: "#8e8e93",
          onPress: () => {
            setMenuAnchor(null);
            handlePhotoCapture();
          },
        },
      ]
    : [];

  const deleteItem: MenuItem | null = menuBlock
    ? {
        key: "delete",
        label: "削除",
        icon: "trash-outline",
        color: "#ff3b30",
        onPress: () => confirmDeleteBlock(menuBlock),
      }
    : null;

  const MENU_ROW_HEIGHT = 44;
  const MENU_ATTR_ROW_HEIGHT = 48;
  const MENU_GAP = 10;
  const MENU_WIDTH = 230;
  const MENU_SCREEN_MARGIN = 40;
  let menuListTop = 0;
  let menuLeft = 0;
  if (menuAnchor) {
    const windowHeight = Dimensions.get("window").height;
    const windowWidth = Dimensions.get("window").width;
    const menuHeight =
      (menuBlock ? MENU_ATTR_ROW_HEIGHT : 0) +
      actionItems.length * MENU_ROW_HEIGHT +
      (deleteItem ? MENU_ROW_HEIGHT : 0);
    const spaceBelow = windowHeight - (menuAnchor.y + menuAnchor.height) - MENU_GAP;
    const spaceAbove = menuAnchor.y - MENU_GAP;
    const showBelow = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
    menuListTop = showBelow
      ? menuAnchor.y + menuAnchor.height + MENU_GAP
      : menuAnchor.y - MENU_GAP - menuHeight;
    const minTop = MENU_SCREEN_MARGIN;
    const maxTop = windowHeight - menuHeight - MENU_SCREEN_MARGIN;
    menuListTop = Math.max(minTop, Math.min(menuListTop, maxTop));
    menuLeft = Math.max(16, Math.min(menuAnchor.x, windowWidth - MENU_WIDTH - 16));
  }

  // 「↓ 新着N件」バッジ用: 一時停止中に増えた発言ブロックの件数
  const textBlockCount = blocks.filter((b) => b.kind === "text").length;
  const newArrivalCount = scrollPaused ? Math.max(0, textBlockCount - pauseBaselineCountRef.current) : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topSection}>
        <TouchableOpacity
          style={styles.debugButton}
          onPress={() => setShowDebug(true)}
          hitSlop={10}
        >
          <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color="#c7c7cc" />
        </TouchableOpacity>

        <View style={styles.statusRow}>
          <View style={[styles.recordingDot, !(running && !paused) && styles.recordingDotIdle]} />
          <Text style={styles.statusLabel}>
            {paused ? "一時停止中" : running ? "収録中" : "待機中"}
          </Text>
          <Text style={styles.statusTimer}>{fmt(elapsedMs)}</Text>
        </View>
      </View>

      <View style={styles.transcriptWrap}>
      {markSelectMode ? (
        <View style={styles.markSelectBannerContainer} pointerEvents="box-none">
          <View style={styles.markSelectBanner}>
            <Text style={styles.markSelectBannerText}>
              {markSelectMode === "star"
                ? "★を付ける発言をタップしてください"
                : markSelectMode === "todo"
                ? "📝を付ける発言をタップしてください"
                : "❓を記録する発言をタップしてください"}
            </Text>
            <TouchableOpacity onPress={cancelMarkSelectMode} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {scrollPaused && newArrivalCount > 0 ? (
        <View style={styles.followBadgeContainer} pointerEvents="box-none">
          <TouchableOpacity style={styles.followBadge} activeOpacity={0.85} onPress={resumeAutoScroll}>
            <Ionicons name="arrow-down" size={13} color="#fff" />
            <Text style={styles.followBadgeText}>{`新着 ${newArrivalCount}件`}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
        onContentSizeChange={() => {
          if (!scrollPaused) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        {sections.map((section, sectionIndex) => {
          const rangeText =
            section.blocks.length === 0
              ? ""
              : fmt(section.blocks[0].ms) === fmt(section.blocks[section.blocks.length - 1].ms)
              ? fmt(section.blocks[0].ms)
              : `${fmt(section.blocks[0].ms)} 〜 ${fmt(section.blocks[section.blocks.length - 1].ms)}`;
          return (
            <View key={section.key} style={styles.sectionWrap}>
              {sectionGroupingEnabled && sectionIndex > 0 ? <View style={styles.sectionDivider} /> : null}
              {sectionGroupingEnabled ? (
                // 録音中は折りたたみを行わないため、見出しはタップ不可のプレーンな表示にする
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeader}>
                    セクション{sectionIndex + 1} ({rangeText})
                  </Text>
                </View>
              ) : null}
              {section.blocks.map((b, blockIndexInSection) => {
              if (b.kind === "sys") {
                return (
                  <Text key={b.id ?? `${section.key}-${blockIndexInSection}`} style={styles.sysText}>
                    [{fmt(b.ms)}] {b.text}
                  </Text>
                );
              }
              const badges = recordBlockBadges(b);
              const marked = badges.length > 0;
              const isEditing = !!b.id && editingBlockId === b.id;
              // 「間」が短いほど、同じ段落として行間を詰めて自然に繋げて見せる(ノート詳細画面と同じ考え方)。
              // オフの場合はフラットな時系列リストにするため計算しない
              const spacing = sectionGroupingEnabled
                ? recordRowSpacingFor(section.blocks[blockIndexInSection - 1], b)
                : "line";
              const body = isEditing ? (
                <View style={styles.transcriptEditBody}>
                  <TextInput
                    style={styles.editTextInput}
                    value={editDraft}
                    onChangeText={setEditDraft}
                    autoFocus
                    multiline
                  />
                  <View style={styles.editActionsRow}>
                    <TouchableOpacity style={styles.editActionButton} onPress={cancelBlockEdit}>
                      <Text style={styles.editActionButtonText}>キャンセル</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editActionButton, styles.editActionButtonPrimary]}
                      onPress={commitBlockEdit}
                    >
                      <Text style={styles.editActionButtonPrimaryText}>完了</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={styles.transcriptText}>{b.text}</Text>
              );

              return (
                <TouchableOpacity
                  key={b.id ?? `${section.key}-${blockIndexInSection}`}
                  activeOpacity={0.7}
                  onPress={markSelectMode && b.id ? () => pickBlockForMark(b) : undefined}
                  onLongPress={() => !markSelectMode && b.id && openBlockMenu(b)}
                  ref={(node) => {
                    if (!b.id) return;
                    if (node) blockRowRefs.current.set(b.id, node as unknown as View);
                    else blockRowRefs.current.delete(b.id);
                  }}
                  style={[
                    marked ? styles.transcriptMarkedRow : styles.transcriptRow,
                    spacing === "paragraph" && styles.transcriptRowParagraph,
                  ]}
                >
                  {marked ? (
                    <>
                      <View style={styles.transcriptMarkedHeader}>
                        <View style={styles.transcriptBadgeRow}>
                          {badges.map((badge) => (
                            <Ionicons key={badge.key} name={badge.icon} size={13} color={badge.color} />
                          ))}
                        </View>
                        <Text style={styles.transcriptMarkedTime}>{fmt(b.ms)}</Text>
                      </View>
                      {body}
                    </>
                  ) : (
                    <>
                      <Text style={styles.transcriptTime}>{fmt(b.ms)}</Text>
                      {body}
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
            </View>
          );
        })}
        {!blocks.length && !interim ? (
          <Text style={styles.placeholderText}>
            {running ? "話しかけると文字起こしが表示されます" : "「開始」を押すと録音が始まります"}
          </Text>
        ) : null}
        {!running && audioUris.length === 1 ? (
          <Playback uri={audioUris[0]} blocks={blocks} leadSec={leadSec} />
        ) : null}
      </ScrollView>
      </View>

      <LiveFocusBand text={interim} running={running && !paused} />

      <View style={styles.bottomSection}>
        <View style={styles.bottomCard}>
          <View style={styles.tileRow}>
            {MARK_TILES.map((t) => (
              <MarkTile
                key={t.key}
                tile={t}
                active={activeMark === t.key}
                onPress={handleMarkPress}
                onLongPress={startMarkSelectMode}
              />
            ))}
          </View>

          <View style={styles.controlRow}>
            <TouchableOpacity
              style={styles.controlButtonPause}
              onPress={paused ? resume : running ? pause : start}
              activeOpacity={0.75}
            >
              <Ionicons name={running && !paused ? "pause" : "play"} size={18} color="#1c1c1e" />
              <Text style={styles.controlButtonPauseText}>
                {paused ? "再開" : running ? "一時停止" : "開始"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButtonStop, !running && styles.controlButtonDisabled]}
              onPress={endSession}
              disabled={!running}
              activeOpacity={0.75}
            >
              <Ionicons name="square" size={14} color="#fff" />
              <Text style={styles.controlButtonStopText}>終了</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal visible={showDebug} animationType="slide" transparent onRequestClose={() => setShowDebug(false)}>
        <Pressable style={styles.debugOverlay} onPress={() => setShowDebug(false)}>
          <Pressable style={styles.debugPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.debugTitle}>検証用デバッグ情報</Text>
            <Text style={styles.mono}>{diag}</Text>
            <Text style={styles.mono}>
              再起動 {restarts} 回 / 音声ファイル {audioUris.length} 個
            </Text>
            <View style={styles.debugLeadRow}>
              <Text style={styles.debugLeadLabel}>手前 {leadSec.toFixed(1)} 秒</Text>
              <TouchableOpacity
                style={[styles.pillButton, styles.pillButtonSmall]}
                onPress={() => setLeadSec((v) => Math.round((v - 0.2) * 10) / 10)}
              >
                <Text style={[styles.pillButtonText, styles.pillButtonTextSmall]}>-0.2</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pillButton, styles.pillButtonSmall]}
                onPress={() => setLeadSec((v) => Math.round((v + 0.2) * 10) / 10)}
              >
                <Text style={[styles.pillButtonText, styles.pillButtonTextSmall]}>+0.2</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.pillButton}
              onPress={() => setShowLog(rawLog.current.join("\n"))}
            >
              <Text style={styles.pillButtonText}>生ログを表示</Text>
            </TouchableOpacity>
            <ScrollView style={styles.debugLogScroll}>
              <Text style={styles.mono}>{showLog}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.pillButton, styles.pillButtonPrimary]}
              onPress={() => setShowDebug(false)}
            >
              <Text style={[styles.pillButtonText, styles.pillButtonTextPrimary]}>閉じる</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={questionChoiceVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setQuestionChoiceVisible(false)}
      >
        <Pressable style={styles.debugOverlay} onPress={() => setQuestionChoiceVisible(false)}>
          <Pressable style={styles.promptPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.debugTitle}>❓を記録</Text>
            <View style={styles.questionChoiceRow}>
              <TouchableOpacity
                style={styles.questionChoiceButton}
                activeOpacity={0.8}
                onPress={() => chooseQuestionKind("question")}
              >
                <Ionicons name="help-circle" size={28} color="#7c4dff" />
                <Text style={styles.questionChoiceLabel}>質問</Text>
                <Text style={styles.questionChoiceHint}>あとで聞きたいこと</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.questionChoiceButton}
                activeOpacity={0.8}
                onPress={() => chooseQuestionKind("term")}
              >
                <Ionicons name="book" size={28} color="#7c4dff" />
                <Text style={styles.questionChoiceLabel}>用語</Text>
                <Text style={styles.questionChoiceHint}>わからなかった言葉</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={questionModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setQuestionModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.promptKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.debugOverlay} onPress={() => setQuestionModalVisible(false)}>
            <Pressable style={styles.promptPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.debugTitle}>わからなかった単語</Text>
              <TextInput
                style={styles.promptInput}
                value={questionTermInput}
                onChangeText={setQuestionTermInput}
                placeholder="例: アブレーション"
                autoFocus
              />
              <View style={styles.promptButtonRow}>
                <TouchableOpacity
                  style={styles.pillButton}
                  onPress={() => {
                    setQuestionModalVisible(false);
                    setQuestionTermInput("");
                  }}
                >
                  <Text style={styles.pillButtonText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pillButton, styles.pillButtonPrimary]}
                  onPress={confirmQuestion}
                >
                  <Text style={[styles.pillButtonText, styles.pillButtonTextPrimary]}>保存</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={memoModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setMemoModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.promptKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.debugOverlay} onPress={() => setMemoModalVisible(false)}>
            <Pressable style={styles.promptPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.debugTitle}>メモ</Text>
              <TextInput
                style={[styles.promptInput, styles.promptInputMultiline]}
                value={memoInput}
                onChangeText={setMemoInput}
                placeholder="メモを入力"
                multiline
                autoFocus
              />
              <View style={styles.promptButtonRow}>
                <TouchableOpacity
                  style={styles.pillButton}
                  onPress={() => {
                    setMemoModalVisible(false);
                    setMemoInput("");
                  }}
                >
                  <Text style={styles.pillButtonText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pillButton, styles.pillButtonPrimary]}
                  onPress={confirmMemo}
                >
                  <Text style={[styles.pillButtonText, styles.pillButtonTextPrimary]}>保存</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={menuAnchor !== null} animationType="fade" transparent onRequestClose={closeBlockMenu}>
        <Pressable style={styles.blockMenuOverlay} onPress={closeBlockMenu}>
          {menuAnchor && menuBlock ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.menuHighlight,
                  {
                    top: menuAnchor.y,
                    left: menuAnchor.x,
                    width: menuAnchor.width,
                    height: menuAnchor.height,
                    transform: [{ scale: menuHighlightScale }],
                  },
                ]}
              >
                <Text style={styles.transcriptTime}>{fmt(menuBlock.ms)}</Text>
                <Text style={styles.transcriptText} numberOfLines={4}>
                  {menuBlock.text}
                </Text>
              </Animated.View>
              <View style={[styles.menuList, { top: menuListTop, left: menuLeft, width: MENU_WIDTH }]}>
                <View style={styles.menuAttrRow}>
                  {attributeButtons.map((attr, index) => (
                    <TouchableOpacity
                      key={attr.key}
                      style={[
                        styles.menuAttrButton,
                        index > 0 && styles.menuAttrButtonDivider,
                        { backgroundColor: attr.active ? attr.activeColor : attr.inactiveBg },
                      ]}
                      onPress={attr.onPress}
                    >
                      <Ionicons name={attr.icon} size={18} color={attr.active ? "#fff" : attr.activeColor} />
                    </TouchableOpacity>
                  ))}
                </View>
                {actionItems.map((item, index) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.menuItem, index > 0 && styles.menuItemDivider]}
                    onPress={item.onPress}
                  >
                    <Text style={styles.menuItemText}>{item.label}</Text>
                    <Ionicons name={item.icon} size={18} color={item.color} />
                  </TouchableOpacity>
                ))}
                {deleteItem ? (
                  <TouchableOpacity
                    style={[styles.menuItem, styles.menuItemDivider]}
                    onPress={deleteItem.onPress}
                  >
                    <Text style={[styles.menuItemText, { color: deleteItem.color }]}>
                      {deleteItem.label}
                    </Text>
                    <Ionicons name={deleteItem.icon} size={18} color={deleteItem.color} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function MarkTile({
  tile,
  active,
  onPress,
  onLongPress,
}: {
  tile: { key: MarkKey; icon: keyof typeof Ionicons.glyphMap; label: string; border: string; bg: string; tint: string };
  active: boolean;
  onPress: (key: MarkKey) => void;
  onLongPress?: (key: MarkKey) => void;
}) {
  // タップ時に一瞬だけ拡大してから元に戻る「押せた」感の演出(スタイルのみ)
  const scale = useRef(new Animated.Value(1)).current;
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.18, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onPress(tile.key);
  };

  return (
    <TouchableOpacity
      style={styles.tileWrap}
      activeOpacity={0.75}
      onPress={handlePress}
      onLongPress={onLongPress ? () => onLongPress(tile.key) : undefined}
    >
      <Animated.View
        style={[
          styles.tileCircle,
          { borderColor: tile.border, backgroundColor: tile.bg },
          active && { backgroundColor: tile.tint, borderColor: tile.tint },
          { transform: [{ scale }] },
        ]}
      >
        <Ionicons name={tile.icon} size={26} color={active ? "#fff" : tile.tint} />
      </Animated.View>
      <Text style={styles.tileLabel}>{tile.label}</Text>
    </TouchableOpacity>
  );
}

// 収録中の「今聞き取っている内容」を表示する帯(チャットアプリの「入力中」表示のように、確定済みタイムラインの直後・操作ボタンの直前に置く)。
// 縮小(1行)⇄展開(円形ビジュアル+複数行テキスト)はタップで切り替える。
// 無操作による自動縮小は行わない(収録が止まった時だけ強制的に縮小する)。
function LiveFocusBand({ text, running }: { text: string; running: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // 収録が止まったら展開状態のままにしない
  useEffect(() => {
    if (!running) setExpanded(false);
  }, [running]);

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpanded((prev) => !prev);
  };

  // 音量バー用のダミーレベル(実データではなく簡易な擬似アニメーション)。展開中は大きい円、縮小中はミニイコライザーとして使う。
  const [circleLevels, setCircleLevels] = useState<number[]>(
    new Array(LIVE_FOCUS_BAR_COUNT).fill(4)
  );
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setCircleLevels(
        Array.from({ length: LIVE_FOCUS_BAR_COUNT }, () => 4 + Math.round(Math.random() * 14))
      );
    }, 220);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;

  return (
    <View style={styles.liveFocusContainer}>
      <View style={styles.liveFocusDivider} />
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={handleToggle}
        style={expanded ? styles.liveFocusExpanded : styles.liveFocusCollapsed}
      >
        {expanded ? (
          <>
            <View style={styles.liveFocusCircle}>
              <View style={styles.liveFocusCircleBars}>
                {circleLevels.map((h, i) => (
                  <View key={i} style={[styles.liveFocusBar, { height: h }]} />
                ))}
              </View>
            </View>
            <Text style={styles.liveFocusTextExpanded}>{text}</Text>
          </>
        ) : (
          <View style={styles.liveFocusRow}>
            <View style={styles.miniEqualizer}>
              {circleLevels.slice(0, 3).map((h, i) => (
                <View
                  key={i}
                  style={[styles.miniEqualizerBar, { height: Math.min(14, h) }]}
                />
              ))}
            </View>
            <Text style={styles.liveFocusTextCollapsed} numberOfLines={1} ellipsizeMode="tail">
              {text}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafc" },

  debugButton: { position: "absolute", top: 0, right: 16, zIndex: 1 },

  topSection: { alignItems: "center", paddingTop: 10, paddingBottom: 4 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#e0342f" },
  recordingDotIdle: { backgroundColor: "#b8b8bd" },
  statusLabel: { fontSize: 16, color: "#1c1c1e", fontWeight: "600" },
  statusTimer: {
    fontSize: 16,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    color: "#1c1c1e",
  },

  transcriptWrap: { flex: 1 },
  // タイル列・コントロール行は別コンテナ(bottomSection)のため、transcriptWrapの
  // 一番下(bottom基準)に置けば、それらと重ならずに一番近い位置に浮かせられる
  followBadgeContainer: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  followBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(28,28,30,0.9)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  followBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  // ★/📝/❓タイル長押しで「ログから選ぶ」モードに入った時、画面上部に出す案内バナー
  markSelectBannerContainer: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  markSelectBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(28,28,30,0.9)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  markSelectBannerText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  transcriptArea: { flex: 1, marginTop: 4, paddingHorizontal: 20 },
  transcriptContent: { paddingBottom: 16 },
  // セクション(発言間の「間」が5秒以上)の区切り。ノート詳細画面と同じ考え方
  sectionWrap: { marginTop: 14 },
  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5ea",
  },
  sectionHeaderRow: { alignSelf: "flex-start" },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginTop: 10,
    marginBottom: 6,
  },
  transcriptRow: { flexDirection: "row", marginBottom: 10, gap: 8 },
  // 発言間の「間」が1.5秒未満のブロックは、同じ段落として自然に繋がって見えるよう行間を詰める
  transcriptRowParagraph: { marginBottom: 2 },
  transcriptTime: { fontSize: 12, color: "#8e8e93", marginTop: 2, width: 40 },
  transcriptText: { fontSize: 16, color: "#1c1c1e", flex: 1, lineHeight: 22 },
  transcriptMarkedRow: {
    borderLeftWidth: 3,
    borderLeftColor: "#d3d3d9",
    paddingLeft: 10,
    marginBottom: 14,
    gap: 3,
  },
  transcriptMarkedHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  transcriptBadgeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  transcriptMarkedTime: { fontSize: 13, fontWeight: "700", color: "#8e8e93" },
  sysText: { fontSize: 12, color: "#c00", marginBottom: 8 },
  transcriptEditBody: { flex: 1 },
  editTextInput: {
    fontSize: 16,
    color: "#1c1c1e",
    lineHeight: 22,
    minHeight: 60,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#06c",
    borderRadius: 8,
    padding: 8,
    backgroundColor: "#fff",
  },
  editActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 6,
  },
  editActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#f2f2f7",
  },
  editActionButtonPrimary: { backgroundColor: "#06c" },
  editActionButtonText: { fontSize: 13, fontWeight: "600", color: "#06c" },
  editActionButtonPrimaryText: { fontSize: 13, fontWeight: "600", color: "#fff" },

  // 長押しメニュー(ノート詳細画面と同様の見た目)
  blockMenuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  menuHighlight: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  menuList: {
    position: "absolute",
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  menuItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5ea" },
  menuItemText: { fontSize: 15, color: "#1c1c1e" },
  menuAttrRow: { flexDirection: "row", height: 48 },
  menuAttrButton: { flex: 1, alignItems: "center", justifyContent: "center" },
  menuAttrButtonDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: "#e5e5ea" },
  placeholderText: {
    fontSize: 13,
    color: "#b8b8bd",
    textAlign: "center",
    marginTop: 40,
  },

  liveFocusContainer: {
    width: "100%",
    paddingHorizontal: 24,
  },
  liveFocusDivider: {
    height: 1,
    backgroundColor: "#e5e5ea",
    marginBottom: 10,
  },
  liveFocusCollapsed: {
    width: "100%",
    paddingBottom: 8,
  },
  liveFocusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  miniEqualizer: { flexDirection: "row", alignItems: "center", gap: 2, height: 14 },
  miniEqualizerBar: { width: 2, borderRadius: 1, backgroundColor: "#9c9ca3" },
  liveFocusTextCollapsed: { flex: 1, fontSize: 13, color: "#a0a0a6" },

  liveFocusExpanded: {
    width: "100%",
    paddingBottom: 8,
    alignItems: "center",
    gap: 12,
  },
  liveFocusCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#1c1c1e",
    justifyContent: "center",
    alignItems: "center",
  },
  liveFocusCircleBars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 22,
  },
  liveFocusBar: { width: 3, borderRadius: 1.5, backgroundColor: "#9c9ca3" },
  liveFocusTextExpanded: {
    fontSize: 14,
    color: "#a0a0a6",
    textAlign: "center",
    lineHeight: 20,
    minHeight: 20,
  },

  bottomSection: { paddingHorizontal: 14, paddingBottom: 8, paddingTop: 4 },
  bottomCard: {
    backgroundColor: "#fff",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  controlRow: {
    flexDirection: "row",
    gap: 10,
  },
  controlButtonPause: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#eceef1",
  },
  controlButtonPauseText: { fontSize: 16, fontWeight: "600", color: "#1c1c1e" },
  controlButtonStop: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#e0342f",
  },
  controlButtonStopText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  controlButtonDisabled: { opacity: 0.35 },

  tileRow: { flexDirection: "row", justifyContent: "center", gap: 11 },
  tileWrap: { alignItems: "center", width: 58 },
  tileCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  tileLabel: { fontSize: 11, color: "#3c3c43", marginTop: 4 },

  // 0.3だと薄すぎてキーボードが透けて見えてしまうため、適切な濃さまで上げる
  debugOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    zIndex: 10,
  },
  debugPanel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: "70%",
    gap: 10,
  },
  debugTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  debugLogScroll: { maxHeight: 160 },
  debugLeadRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  promptKeyboardAvoider: { flex: 1 },
  promptPanel: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    // キーボードがすぐ下に来た時に入力欄が密着しないよう、下に余白を確保する
    marginBottom: 28,
    alignSelf: "center",
    width: "88%",
    gap: 12,
  },
  questionChoiceRow: { flexDirection: "row", gap: 12 },
  questionChoiceButton: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: "#f5f0ff",
  },
  questionChoiceLabel: { fontSize: 16, fontWeight: "700", color: "#1c1c1e" },
  questionChoiceHint: { fontSize: 11, color: "#8e8e93" },
  promptInput: {
    borderWidth: 1,
    borderColor: "#e2e2e7",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1c1c1e",
  },
  promptInputMultiline: { minHeight: 80, textAlignVertical: "top" },
  promptButtonRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  debugLeadLabel: { fontSize: 13, color: "#3c3c43", minWidth: 76 },

  pillButton: {
    backgroundColor: "#f2f2f7",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  pillButtonText: { fontSize: 14, color: "#06c", fontWeight: "600" },
  pillButtonSmall: { paddingVertical: 6, paddingHorizontal: 10 },
  pillButtonTextSmall: { fontSize: 13 },
  pillButtonPrimary: { backgroundColor: "#06c" },
  pillButtonTextPrimary: { color: "#fff" },

  gap: { marginVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  mono: { fontSize: 11, color: "#555", marginTop: 6 },

  playbackCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#ececef",
    gap: 10,
  },
  playbackHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  playbackMiniButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f2f2f7",
    justifyContent: "center",
    alignItems: "center",
  },
  playbackMeta: { flex: 1 },
  playbackMetaText: { fontSize: 12, color: "#8e8e93" },
  playbackListLabel: { fontSize: 12, color: "#8e8e93", marginTop: 2 },
  playbackTimeLink: { color: "#06c" },
});

function Playback({ uri, blocks, leadSec }: { uri: string; blocks: Block[]; leadSec: number }) {
  const player = useAudioPlayer({ uri });

  return (
    <View style={styles.playbackCard}>
      <View style={styles.playbackHeaderRow}>
        <TouchableOpacity
          style={styles.playbackMiniButton}
          activeOpacity={0.7}
          onPress={() => {
            player.seekTo(0);
            player.play();
          }}
        >
          <Ionicons name="play" size={18} color="#1c1c1e" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.playbackMiniButton}
          activeOpacity={0.7}
          onPress={() => player.pause()}
        >
          <Ionicons name="pause" size={18} color="#1c1c1e" />
        </TouchableOpacity>
        <View style={styles.playbackMeta}>
          <Text style={styles.playbackMetaText}>長さ: {Math.round(player.duration ?? 0)} 秒</Text>
          <Text style={styles.playbackMetaText}>手前 {leadSec.toFixed(1)} 秒から再生</Text>
        </View>
      </View>

      <Text style={styles.playbackListLabel}>タップでその位置から再生</Text>
      {blocks
        .filter((b) => b.kind === "text")
        .map((b, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.6}
            style={styles.transcriptRow}
            onPress={() => {
              player.seekTo(Math.max(0, b.ms / 1000 - leadSec));
              player.play();
            }}
          >
            <Text style={[styles.transcriptTime, styles.playbackTimeLink]}>
              {String(Math.floor(b.ms / 1000 / 60)).padStart(2, "0")}:
              {String(Math.floor(b.ms / 1000) % 60).padStart(2, "0")}
            </Text>
            <Text style={styles.transcriptText}>{b.text}</Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}
