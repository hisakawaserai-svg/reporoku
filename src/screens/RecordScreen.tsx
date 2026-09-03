import { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  View,
  Text,
  ScrollView,
  FlatList,
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
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import { genId } from "../utils/id";
import { deleteStoredFile, getAudioDirectoryUri, persistPhotoFile } from "../utils/files";
import { pickImageUri, promptPhotoSource } from "../utils/pickPhoto";
import { adoptOrphanAudioFiles, deleteOrphanAudioFiles, hasRecoverableAudio } from "../utils/audioRecovery";
import { mergeSessionAudioSegments } from "../utils/audioMerge";
import {
  getAllowBluetoothMic,
  getDefaultParagraphGapMs,
  getDefaultSectionGapMs,
  getPlaybackLeadSec,
  getRecordingSampleRate,
  getSectionGroupingEnabled,
  getSpeechRecognitionLanguage,
  onSpeechRecognitionLanguageChange,
} from "../utils/settings";
import { setIsRecordingActive } from "../utils/recordingStatus";
import type { RootStackParamList, MainTabParamList } from "../navigation/RootNavigator";
import { RowLongPressMenu, useRowLongPressMenu, type RowMenuItem } from "../components/RowLongPressMenu";
import * as colors from "../theme/colors";
import { fontSize } from "../theme/typography";

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

type SleepDisplayItem = { key: string; kind: "interim"; text: string } | { key: string; kind: "block"; block: Block; active: boolean };

const KEEP_AWAKE_TAG = "record-screen";

// ヘッダー左上・ライブフォーカス縮小時の音量イコライザー用
const HEADER_EQ_BAR_COUNT = 9;
const HEADER_EQ_BAR_SCALE = [0.45, 0.6, 0.75, 0.9, 1, 0.9, 0.75, 0.6, 0.45];
const HEADER_EQ_BAR_SMOOTHING = [0.5, 0.35, 0.55, 0.4, 0.6, 0.4, 0.55, 0.35, 0.5];

// 展開時に浮かぶ円形イコライザー用
const LIVE_FOCUS_BAR_COUNT = 5;
// バーごとの高さ係数(中央が高く、端が低い)。全バーが同じ音量値に一斉反応しつつ形に差をつける
const LIVE_FOCUS_BAR_SCALE = [0.7, 0.85, 1, 0.85, 0.7];
// バーごとの反応の速さ(値が大きいほど素早く音量に追従し、小さいほどゆっくり追従する)
const LIVE_FOCUS_BAR_SMOOTHING = [0.6, 0.35, 0.5, 0.4, 0.65];

type MarkKey = "star" | "todo" | "question" | "photo" | "memo";

const MARK_TILES: {
  key: MarkKey;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  border: string;
  bg: string;
  tint: string;
}[] = [
  { key: "star", icon: "star", labelKey: "record.markLabel.star", border: "#f3cf7c", bg: "#fff8e8", tint: colors.star.accent },
  { key: "todo", icon: "checkmark-circle", labelKey: "record.markLabel.todo", border: "#9adcab", bg: "#eefbf1", tint: colors.todo.accent },
  { key: "question", icon: "help-circle", labelKey: "record.markLabel.question", border: "#c9b3f5", bg: "#f5f0ff", tint: "#7c4dff" },
  { key: "photo", icon: "camera", labelKey: "record.markLabel.photo", border: "#d3d3d9", bg: "#f7f7f9", tint: "#57575c" },
  { key: "memo", icon: "create", labelKey: "record.markLabel.memo", border: "#d3d3d9", bg: "#f7f7f9", tint: "#57575c" },
];

const MS_PER_CHAR = 150; // 1文字あたりの推定発話時間(ms)。ノート詳細画面と同じ概算値

// begin()を呼んでからaudiostartが発火するまでこの時間待っても来なければ、
// ネイティブ側の起動が失敗したとみなす(他アプリがまだ音声セッションを離していない場合など)
const BEGIN_WATCHDOG_TIMEOUT_MS = 3000;
// 想定内の中断(no-speech・interrupted)からの自動リトライまでの待機時間。
// interruptedは他アプリが音声セッションを解放するまで少し時間がかかることがあるため、
// no-speechより長めに待ってからリトライする
const NO_SPEECH_RETRY_DELAY_MS = 150;
const INTERRUPTED_RETRY_DELAY_MS = 600;
// Duolingoのように、断続的に長く音声セッションを奪い続けるアプリが相手だと、
// interruptedのリトライを繰り返しても一向に成功しないことがある。この回数を超えたら
// ローカルでの積極的なリトライは諦め、大人しく待つモードに切り替える(強制終了はしない)
const INTERRUPTED_STREAK_LIMIT = 4;
// 大人しく待つモード中、フォアグラウンド復帰イベントが来なくても(例: 他アプリの音声が
// 通知経由などでアプリを切り替えずに割り込むケース)いずれ回復できるよう、この間隔で
// ゆるく再試行し続ける
const PASSIVE_RETRY_INTERVAL_MS = 5000;

// expo-speech-recognitionのエラーコードは開発者向けの英語表記(例: "audio-capture")のため、
// ユーザーが読んでも状況が分かるよう日本語の説明文に置き換える(native側のe.messageは
// プラットフォームごとの生の文言でユーザー向けではないため使わない)
function describeSpeechRecognitionError(code: string, t: TFunction): string {
  switch (code) {
    case "audio-capture":
      return t("record.error.audioCapture");
    case "interrupted":
      return t("record.error.interrupted");
    case "network":
      return t("record.error.network");
    case "not-allowed":
      return t("record.error.notAllowed");
    case "service-not-allowed":
      return t("record.error.serviceNotAllowed");
    case "busy":
      return t("record.error.busy");
    case "language-not-supported":
      return t("record.error.languageNotSupported");
    case "speech-timeout":
      return t("record.error.speechTimeout");
    default:
      return t("record.error.generic");
  }
}

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
function recordRowSpacingFor(prev: Block | undefined, block: Block, paragraphGapMs: number): RecordRowSpacing {
  if (!prev) return "line";
  return gapMsBetween(prev, block) < paragraphGapMs ? "paragraph" : "line";
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
  if (b.isStarred) badges.push({ key: "star", icon: "star", color: colors.star.accent });
  if (b.isTodo) badges.push({ key: "todo", icon: "checkmark-circle", color: colors.todo.accent });
  if (b.isQuestion) badges.push({ key: "question", icon: "help-circle", color: "#7c4dff" });
  return badges;
}

// App.tsx にあった録音・文字起こしの検証コードをそのまま移植したもの。
// ロジックは変更していない。見た目(スタイル)のみ Claude Design 案(3a)に合わせて調整。
export default function RecordScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Record">>();
  // クラッシュ復旧からの再開処理を、同じセッションに対して二重実行しないためのガード。
  // 単なるbooleanだと、1回のアプリ起動で複数のクラッシュセッションを続けて「再開する」を
  // 選んだ場合に、2件目以降の再開が黙って無視されてしまう(画面には1件目の状態が残ったまま
  // 別セッションを再開したと思い込んでしまう)ため、セッションIDそのものを覚えておく
  const resumeHandledSessionIdRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  // ライブフォーカス帯(LiveFocusBand)が展開中かどうか。展開中の円形イコライザーは
  // 画面上部に浮かぶオーバーレイとして別コンポーネントで描画するため、その表示可否の判定に使う。
  // オーバーレイをタップして閉じられるようにするため、展開状態はここ(親)で持つ
  const [bandExpanded, setBandExpanded] = useState(false);

  // 収録が止まったら展開状態のままにしない
  useEffect(() => {
    if (!running) setBandExpanded(false);
  }, [running]);

  // 設定画面が「録音中に言語を変えてよいか」を判断できるよう、収録中(一時停止していない)
  // かどうかを共有stateに反映する。画面を離れても値が古いまま残らないよう、
  // アンマウント時には必ずfalseに戻す
  useEffect(() => {
    setIsRecordingActive(running && !paused);
    return () => setIsRecordingActive(false);
  }, [running, paused]);

  // 設定画面で音声認識の言語が変更された時、収録中であればその場でセッションを
  // 再起動して新しい言語をすぐに反映する。待機中・一時停止中は何もしない
  // (次に録音を始めた時にgetSpeechRecognitionLanguage()経由で自然に新しい値が使われる)
  useEffect(() => {
    return onSpeechRecognitionLanguageChange(() => {
      if (!running || paused) return;
      isChangingLanguageRef.current = true;
      ExpoSpeechRecognitionModule.stop();
    });
  }, [running, paused]);

  // スリープモード(Claude Design案 1c): 画面を暗くして直近数行だけを薄く表示する省電力・
  // 非集中表示モード。DB結線・音声認識ロジックには関与しない、見た目専用の状態
  const [sleepMode, setSleepMode] = useState(false);
  useEffect(() => {
    if (!running) setSleepMode(false);
  }, [running]);

  // スリープ解除は誤操作防止のため単純タップではなく長押しにし、押している間だけ
  // 画面が徐々に明るくなる(=解除に近づいている)ことが視覚的にわかるようにする
  const SLEEP_WAKE_HOLD_MS = 800;
  const sleepWakeAnim = useRef(new Animated.Value(0)).current;
  const sleepWakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSleepWakeTimer = () => {
    if (sleepWakeTimerRef.current) {
      clearTimeout(sleepWakeTimerRef.current);
      sleepWakeTimerRef.current = null;
    }
  };
  const handleSleepWakePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.timing(sleepWakeAnim, {
      toValue: 1,
      duration: SLEEP_WAKE_HOLD_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    sleepWakeTimerRef.current = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      // ちょうどtoValue:1に到達し切る前後のタイミングでネイティブ側のアニメーションが
      // まだ動いていると、直後のsetValue(0)がそのフレームで上書きされてしまうことがある。
      // stopAnimationで確実に止めてから0に戻す
      sleepWakeAnim.stopAnimation(() => sleepWakeAnim.setValue(0));
      setSleepMode(false);
    }, SLEEP_WAKE_HOLD_MS);
  };
  const handleSleepWakePressOut = () => {
    clearSleepWakeTimer();
    Animated.timing(sleepWakeAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };
  // 突入・解除どちらの切り替わりでも明るさを0(=黒背景)に戻しておく。そうしないと、次に
  // スリープモードに入った時、前回長押しを離す前に手を止めた分の明るさが残ってしまう
  useEffect(() => {
    clearSleepWakeTimer();
    sleepWakeAnim.stopAnimation(() => sleepWakeAnim.setValue(0));
    return clearSleepWakeTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepMode]);

  // スリープモード中はタブバーも隠す(画面全体を暗い表示に集中させるため)。
  // 画面遷移でアンマウントされる場合に備え、必ず表示状態に戻してから抜ける
  const tabNavigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  useEffect(() => {
    tabNavigation.setOptions({ tabBarStyle: sleepMode ? { display: "none" } : undefined });
    return () => {
      tabNavigation.setOptions({ tabBarStyle: undefined });
    };
  }, [sleepMode, tabNavigation]);
  // クラッシュ復旧の「録音を再開する」直後、タイムライン復元は終わっているが、マイク権限確認や
  // 孤児音声ファイルの取り込みがまだ終わっておらずbegin()前の状態。この間は「待機中」に見えて
  // 実際には録音再開の準備が進行中のため、誤って「開始」を押して新規セッションが
  // 作られてしまわないよう操作を止めておく
  const [restoring, setRestoring] = useState(false);
  // 「復元中…」が数秒〜10秒ほど続くことがあり、見た目が止まって見えて
  // フリーズと勘違いされやすいため、進行中であることが伝わるよう点を増減させる
  const [restoringDots, setRestoringDots] = useState(1);
  useEffect(() => {
    if (!restoring) {
      setRestoringDots(1);
      return;
    }
    const id = setInterval(() => setRestoringDots((n) => (n % 3) + 1), 450);
    return () => clearInterval(id);
  }, [restoring]);
  const restoringLabel = `${t("record.status.restoring")}${".".repeat(restoringDots)}`;
  // 復元は完了しているが、まだユーザーが「開始」を押していない(=マイクはまだ起動していない)
  // セッションID。「録音を再開する」を選んだだけで勝手に録音を始めないよう、実際に
  // 録音を始めるのはユーザーが明示的に「開始」を押した時点にする
  const pendingResumeSessionIdRef = useRef<string | null>(null);
  const isPausingRef = useRef(false);       // 意図的な一時停止によるstopか(自動再開・完全終了と区別する)
  // 「リセット」による破棄目的のstopか。trueの場合、endイベント側では保存(finalize)せず
  // セッションを丸ごと削除する
  const isDiscardingRef = useRef(false);
  // 設定画面で音声認識の言語が変更されたことによる、意図的な再起動目的のstopか。
  // 失敗として扱わず、新しい言語ですぐにbegin()し直す
  const isChangingLanguageRef = useRef(false);
  // 「end」イベントが何らかの理由で二重に発火した場合、finalize/clearScreenStateを
  // 2回走らせない(=既に確定済みのタイムラインを巻き戻さない)ためのガード
  const finalizedRef = useRef(false);
  const contentMsRef = useRef(0);           // 実際に録音された音声の累積時間(セッション全体のタイムライン基準はこれ。再起動・一時停止による空白時間は含まない)
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [interim, setInterim] = useState("");
  const [audioUris, setAudioUris] = useState<string[]>([]);
  const [diag, setDiag] = useState("");
  const [restarts, setRestarts] = useState(0);

  // スリープモードのログ表示はFlatList+invertedで、画面に見えていない行は
  // 描画されない(仮想化される)ようにする。通常モードと同じく最新の発言が
  // 画面下部に来るよう、新しい行が増えるたびに先頭(=inverted下では画面下端)へ
  // 自動スクロールする
  const sleepScrollRef = useRef<FlatList<SleepDisplayItem>>(null);
  const sleepTextBlockCount = blocks.filter((b) => b.kind === "text").length;
  useEffect(() => {
    if (!sleepMode) return;
    sleepScrollRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [sleepMode, sleepTextBlockCount, interim]);

  const startedAt = useRef(0);
  const shouldRun = useRef(false);      // ユーザーが「止めたい」のか判別
  const failStreak = useRef(0);         // 無限リトライ防止(原因不明の単発的な起動失敗用)
  // interruptedによる再起動が、audiostartに到達しないまま何回連続で失敗しているか。
  // failStreakとは別に数える。Duolingoのように断続的に長くセッションを奪い続ける相手だと、
  // 通常のfailStreakと同じ扱いにしてしまうと強制終了に至ってしまうため分離している
  const interruptedStreak = useRef(0);
  const lastErrorWasNoSpeechRef = useRef(false); // 直前の再起動がno-speech(無音)由来か。failStreakの誤カウント防止用
  // 直前の再起動がinterrupted(他アプリに音声セッションを奪われた)由来か。no-speechと同様、
  // 想定内の中断として扱い、failStreakにはカウントしない(ただし少し長めに待ってからリトライする)
  const lastErrorWasInterruptedRef = useRef(false);
  // 直近のbegin()呼び出しが、どの理由によるリトライだったか。ウォッチドッグが発火した際、
  // interrupted由来の連続失敗として数えるか、原因不明の失敗(failStreak)として数えるかの判定に使う
  const lastBeginReasonRef = useRef<"interrupted" | "generic">("generic");
  const lastResultAt = useRef(0);
  const segStart = useRef<number | null>(null);
  const [leadSec, setLeadSec] = useState(getPlaybackLeadSec);

  const isRecognizingRef = useRef(false);            // 現在ネイティブ側の音声認識セッションが動いているか(audiostart〜end間)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // begin()を呼んだのにaudiostartが一定時間発火しない(=ネイティブ側の起動が実質的に
  // 失敗した)場合の見張りタイマー。他アプリがまだ音声セッションを離していない場合などに、
  // "end"イベント自体が二度と来ず、isRecognizingRefがtrueのまま固まってしまうのを防ぐ
  const beginWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // interruptedStreakが上限を超え、積極的なリトライを諦めて「大人しく待つ」モードに
  // 入っている間、ゆるい間隔でbegin()を試み続けるためのタイマー
  const passiveRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // DB連携用の状態
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef(0);   // セッション全体の開始時刻(音声認識の再起動では変わらない)
  // このセッションのセクション区切り・段落の閾値(ms)。開始時に設定画面のデフォルト値を読み込んで固定する。
  // 録音画面自体には調整UIを置かない(微調整はノート詳細画面のスライダーに一本化)ため、録音中は変わらない
  const sectionGapMsRef = useRef(5000);
  const paragraphGapMsRef = useRef(1500);
  const lastBlockIdRef = useRef<string | null>(null); // 直近確定した文字起こしブロックのID
  const audioSeqRef = useRef(0);           // 音声ファイルの連番(再起動のたびにインクリメント)

  const [memoModalVisible, setMemoModalVisible] = useState(false);
  const [memoInput, setMemoInput] = useState("");

  // ★/📝/❓タイルを長押しした時の「ログの発言をタップして選ぶ」モード。
  // 別モーダルは出さず、画面内に既に見えているタイムラインをそのまま選択先にする
  const [markSelectMode, setMarkSelectMode] = useState<MarkKey | null>(null);

  // タイムライン上でブロックを長押しして開く「結合/分割/マーク」メニュー相当(録音中は結合/分割は無し)。
  // 他画面と共通のRowLongPressMenuを使う。データは常に最新のblocksから引き直せるよう、
  // ブロックそのものではなくblockIdだけを保持する
  const rowMenu = useRowLongPressMenu<string>();
  // 長押しメニューからの「テキスト編集」で編集中のブロック
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // 長押しで新着への自動スクロールを一時停止しているか。「↓ 新着N件」バッジをタップするまで解除しない
  const [scrollPaused, setScrollPaused] = useState(false);
  // 一時停止を始めた時点の発言ブロック数。バッジの「新着N件」はここからの増分
  const pauseBaselineCountRef = useRef(0);
  // 「↓ 新着N件」バッジは、増えた分が画面内に収まらずスクロールしないと見えない場合だけ出したい。
  // ScrollViewの表示領域とコンテンツ全体の高さを比較してその判定に使う
  const [transcriptViewportHeight, setTranscriptViewportHeight] = useState(0);
  const [transcriptContentHeight, setTranscriptContentHeight] = useState(0);

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
    // 「実際に録音された音声の長さ」を保存する(一時停止・再起動・クラッシュ〜再開の
    // 空白時間は含まれない)。壁時計時間(Date.now() - 開始時刻)だと、再開までの空白が
    // 長いセッションで実態とかけ離れた値になってしまうため、常にこちらを使う。
    // ただし、強制終了によってセグメントの途中でaudioendが発火しないまま終わった場合、
    // その最後のセグメント分の時間がcontentMsRefに一切加算されない(録音時間が実際より
    // 短く記録される)ことがある。直近の発言の終了時刻(prevEnd)を下限にすることで、
    // 少なくとも「最後のログの時刻」より短い長さが保存されてしまう事態を防ぐ
    const durationMs = Math.max(contentMsRef.current, prevEnd.current);
    sessionsRepo
      .updateDuration(sessionId, durationMs)
      .catch((e) => console.warn("[DB] セッション長さの更新に失敗しました", e));

    // 複数セグメントに分かれた音声を1本のWAVへ結合する(「記録が完了しました」ポップアップの
    // 裏側でバックグラウンド実行される)。画面遷移や保存完了の表示はここでは待たない
    mergeSessionAudioSegments(sessionId).catch((e) =>
      console.warn("[FS] 音声セグメントの結合に失敗しました", e)
    );
  };

  // テキスト・メモ・写真(blocks)が1件も無く、音声(登録済み・孤児ファイルとも)も一切無い
  // 空のセッションなら、保存する意味が無いのでレコードごと削除する。削除したらtrueを返す
  const deleteSessionIfEmpty = async (sessionId: string): Promise<boolean> => {
    const [session, blocks] = await Promise.all([
      sessionsRepo.getById(sessionId),
      blocksRepo.listBySessionId(sessionId),
    ]);
    if (!session || blocks.length > 0) return false;
    const hasAudio = await hasRecoverableAudio(session).catch(() => true); // 判定失敗時は安全側(残す)
    if (hasAudio) return false;
    await sessionsRepo.deleteById(sessionId).catch((e) => console.warn("[DB] 空セッションの削除に失敗しました", e));
    return true;
  };

  // 終了処理の共通口。空セッションなら黙って削除し、そうでなければ通常通り確定させる
  const finalizeOrDiscardEmptySession = async (options: { showComplete: boolean; clearAfter: boolean }) => {
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      const deleted = await deleteSessionIfEmpty(sessionId);
      if (!deleted) {
        finalizeSessionDuration();
        if (options.showComplete) goToRecordComplete();
      }
    }
    if (options.clearAfter) clearScreenState();
  };

  // ユーザーが明示的に「終了」した時だけ、保存完了画面に遷移する(エラーによる強制中断時は遷移しない)。
  // 呼び出し元(finalizeOrDiscardEmptySession)で「中身が完全に空」の場合は既に除外済みのため、
  // ここでは★・📝・❓の有無にかかわらず常に遷移する(マークが無いだけで何の画面遷移も無いのは
  // 「ちゃんと保存されたのか分からない」という不親切さにつながるため)
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

  // 「リセット」確定後、実際にセッション一式(DBレコード・音声ファイル・写真ファイル)を削除する。
  // クラッシュ復旧画面の破棄処理(discardCrashedSession)と同じ考え方で、DB未登録のまま
  // 残っている孤児音声ファイルも含めて削除してから、セッション本体・関連ブロックを消す
  const performDiscardCurrentSession = async () => {
    const sessionId = sessionIdRef.current;
    setRunning(false);
    setPaused(false);
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (sessionId) {
      try {
        const [session, sessionBlocks, audioFiles] = await Promise.all([
          sessionsRepo.getById(sessionId),
          blocksRepo.listBySessionId(sessionId),
          audioFilesRepo.listBySessionId(sessionId),
        ]);
        if (session) await deleteOrphanAudioFiles(session);
        await sessionsRepo.deleteById(sessionId);
        await Promise.all([
          ...sessionBlocks.filter((b) => b.kind === "photo" && b.photoUri).map((b) => deleteStoredFile(b.photoUri as string)),
          ...audioFiles.map((f) => deleteStoredFile(f.fileUri)),
        ]);
      } catch (e) {
        console.warn("[DB] セッションのリセットに失敗しました", e);
      }
    }
    sessionIdRef.current = null;
    clearScreenState();
  };

  // 収録画面の「リセット」ボタン。保存も画面遷移もせず、ここまでの録音を丸ごと破棄して
  // 「待機中」の状態に戻す(終了ボタンと違い、録音完了画面には遷移しない)
  const handleReset = () => {
    Alert.alert(
      t("record.resetConfirm.title"),
      t("record.resetConfirm.message"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("record.resetConfirm.confirm"),
          style: "destructive",
          onPress: () => {
            if (running && !paused) {
              // ネイティブの音声認識セッションを止めてから破棄する(endイベント側で実行)
              isDiscardingRef.current = true;
              shouldRun.current = false;
              ExpoSpeechRecognitionModule.stop();
              return;
            }
            // 一時停止中・待機中はネイティブ側が既に止まっているので即座に破棄する
            shouldRun.current = false;
            performDiscardCurrentSession();
          },
        },
      ]
    );
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

  // ★/📝と同じ「即座にマークするだけ」の挙動。録音中は質問/用語の仕分けをさせず、
  // is_questionだけ立てて後でノート詳細画面から落ち着いて仕分けてもらう
  // (question_kind/question_termはここでは一切触れない)
  const toggleQuestionOnLastBlock = () => {
    const id = lastBlockIdRef.current;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isQuestion: !b.isQuestion } : b)));
    blocksRepo.toggleQuestion(id).catch((e) => console.warn("[DB] ❓切替に失敗しました", e));
  };

  const confirmMemo = () => {
    const sessionId = sessionIdRef.current;
    const text = memoInput.trim();
    setMemoModalVisible(false);
    setMemoInput("");
    if (!sessionId || !text) return;
    const startMs = sessionElapsedMs();
    const id = genId();
    // DBには文字起こしと区別できる"note"種別で保存するが、収録画面のログはtext/sysしか
    // 描画しないため、その場でログにも出るようsysブロックとして画面にも積む
    push(t("record.log.memo", { text }), "sys", startMs, id);
    blocksRepo
      .create({ id, sessionId, kind: "note", startMs, text })
      .catch((e) => console.warn("[DB] メモの保存に失敗しました", e));
  };

  const handlePhotoCapture = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    promptPhotoSource(t, async (source) => {
      try {
        const picked = await pickImageUri(source);
        if (!picked.ok) {
          if (source === "camera" && picked.reason === "denied") {
            push(t("record.log.cameraPermissionDenied"), "sys");
          }
          return;
        }
        const startMs = sessionElapsedMs();

        // cache URIのままだとOSに削除される恐れがあるため、documentDirectory配下へコピーする
        let photoUri = picked.uri;
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
    });
  };

  // 長押しで「結合/分割/マーク」メニューを開く。録音中は結合・分割は不要なため省いている。
  // 開いた瞬間、まだ一時停止していなければ新着自動スクロールを止め、その時点の件数を基準点にする
  const openBlockMenu = (block: Block) => {
    if (!block.id || editingBlockId) return;
    if (!scrollPaused) {
      pauseBaselineCountRef.current = blocks.filter((b) => b.kind === "text").length;
      setScrollPaused(true);
    }
    rowMenu.open(block.id, block.id);
  };

  const closeBlockMenu = () => rowMenu.close();

  // 「↓ 新着N件」バッジをタップしたときの再開。自動スクロールを再開し、最新まで一度ジャンプする
  const resumeAutoScroll = () => {
    setScrollPaused(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  const toggleBlockStar = (block: Block) => {
    rowMenu.close();
    const id = block.id;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isStarred: !b.isStarred } : b)));
    blocksRepo.toggleStar(id).catch((e) => console.warn("[DB] スター切替に失敗しました", e));
  };

  const toggleBlockTodo = (block: Block) => {
    rowMenu.close();
    const id = block.id;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isTodo: !b.isTodo } : b)));
    blocksRepo.toggleTodo(id).catch((e) => console.warn("[DB] ToDo切替に失敗しました", e));
  };

  // ★/📝と同じ「即座にマークするだけ」の挙動。question_kind/question_termには触れない
  // (仕分けはノート詳細画面の長押しメニューで後から行う)
  const toggleBlockQuestion = (block: Block) => {
    rowMenu.close();
    const id = block.id;
    if (!id) return;
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, isQuestion: !b.isQuestion } : b)));
    blocksRepo.toggleQuestion(id).catch((e) => console.warn("[DB] ❓切替に失敗しました", e));
  };

  const startEditingBlock = (block: Block) => {
    rowMenu.close();
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
    rowMenu.close();
    const id = block.id;
    if (!id) return;
    Alert.alert(t("record.deleteBlockConfirm.title"), t("record.deleteBlockConfirm.message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
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
    lastErrorWasNoSpeechRef.current = false; // 新しいセグメントが実際に始まったので、直前のno-speech/interruptedフラグは持ち越さない
    lastErrorWasInterruptedRef.current = false;
    interruptedStreak.current = 0; // 実際に起動できたので、割り込み連続失敗のカウントもリセットする
    clearBeginWatchdog(); // 実際にネイティブ側の起動が確認できたので、見張りタイマーは不要
    clearPassiveRetryTimer(); // 大人しく待つモード中だった場合、成功したのでもう不要
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
    if (e.error === "no-speech") {
      lastErrorWasNoSpeechRef.current = true;
      return;
    }
    lastErrorWasNoSpeechRef.current = false;
    // interrupted(他アプリに音声セッションを奪われた)も、no-speechと同じく想定内の中断として扱う。
    // ただし他アプリがセッションを解放するまで少し時間がかかることがあるため、endイベント側で
    // 通常より長めに待ってからリトライする(このフラグで区別する)
    lastErrorWasInterruptedRef.current = e.error === "interrupted";
    // continuousモードでは直後に自動再開されるため、その旨も併記して不安にさせないようにする
    push(t("record.error.autoRestartMessage", { message: describeSpeechRecognitionError(e.error, t) }), "sys");
  });

  // アプリがバックグラウンド寄りの状態かどうかを、AppStateの変化イベント経由で更新される
  // appStateRef(反映が一瞬遅れることがある)と、その時点の生の値であるAppState.currentStateの
  // 両方で確認する。通話中などでイベントの反映が遅れていても、どちらかがバックグラウンドを
  // 示していれば、ローカルでの執拗なリトライは行わずフォアグラウンド復帰の仕組みに委ねる
  const isAppBackgrounded = () =>
    appStateRef.current !== "active" || AppState.currentState !== "active";

  const clearBeginWatchdog = () => {
    if (beginWatchdogTimerRef.current) {
      clearTimeout(beginWatchdogTimerRef.current);
      beginWatchdogTimerRef.current = null;
    }
  };

  const clearPassiveRetryTimer = () => {
    if (passiveRetryTimerRef.current) {
      clearInterval(passiveRetryTimerRef.current);
      passiveRetryTimerRef.current = null;
    }
  };

  // interruptedStreakが上限を超えた時に入るモード。強制終了はせず、shouldRun.currentもtrueの
  // ままにして、フォアグラウンド復帰イベント(AppState)に加えて、念のためゆるい間隔での
  // ポーリングでも回復のチャンスを作る(通知経由の音声などでAppStateが一切変化しないケースの保険)
  const enterPassiveWaitMode = () => {
    clearPassiveRetryTimer();
    passiveRetryTimerRef.current = setInterval(() => {
      if (!shouldRun.current) {
        clearPassiveRetryTimer();
        return;
      }
      if (isRecognizingRef.current) return; // 既に別経路で再開できていれば何もしない
      if (isAppBackgrounded()) return; // バックグラウンドならフォアグラウンド復帰の仕組みに任せる
      lastBeginReasonRef.current = "interrupted";
      begin();
    }, PASSIVE_RETRY_INTERVAL_MS);
  };

  // 一定時間待ってからbegin()を再試行する。
  // - reason="generic": 原因不明の単発的な失敗。failStreakに加算し、閾値を超えたら従来通り強制終了する
  // - reason="interrupted": 他アプリによる割り込みからの復帰。failStreakには加算しないが、
  //   interruptedStreakとして別に数え、上限を超えたら積極的なリトライを諦めて大人しく待つモードに入る
  //   (強制終了はしない)
  // - reason="no-speech": 無音による正常な再起動。どちらのカウンタにも加算しない
  const scheduleRestart = (delayMs: number, reason: "no-speech" | "interrupted" | "generic") => {
    if (reason === "generic") {
      failStreak.current += 1;
      if (failStreak.current > 8) {
        if (finalizedRef.current) return;
        finalizedRef.current = true;
        setAudioModeAsync({ allowsRecording: false }).catch(() => {});
        push(t("record.error.repeatedFailure"), "sys");
        shouldRun.current = false;
        setRunning(false);
        finalizeOrDiscardEmptySession({ showComplete: false, clearAfter: false });
        return;
      }
    } else if (reason === "interrupted") {
      interruptedStreak.current += 1;
      if (interruptedStreak.current > INTERRUPTED_STREAK_LIMIT) {
        enterPassiveWaitMode();
        return;
      }
    }
    setRestarts((n) => n + 1);
    setTimeout(() => {
      if (!shouldRun.current) return;
      // 待機中にバックグラウンドへ回っていた場合は、ここでのリトライはせず
      // フォアグラウンド復帰時の仕組みに委ねる(通話中などにセッションを奪い返そうとしない)
      if (isAppBackgrounded()) return;
      lastBeginReasonRef.current = reason === "interrupted" ? "interrupted" : "generic";
      begin();
    }, delayMs);
  };

  // ここが肝:終了したら、止めたいわけでなければ即座に再開
  useSpeechRecognitionEvent("end", () => {
    isRecognizingRef.current = false;
    clearBeginWatchdog();

    if (isDiscardingRef.current) {
      // リセットによるstop。保存せず、セッションを丸ごと破棄する
      isDiscardingRef.current = false;
      finalizedRef.current = true; // 通常の終了処理(保存)が後から走らないようにする
      performDiscardCurrentSession();
      return;
    }

    if (isPausingRef.current) {
      // 一時停止による停止。セッションは終了させず、次の「再開」を待つ
      isPausingRef.current = false;
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      return;
    }
    if (isChangingLanguageRef.current) {
      // 言語切り替えによる意図的な再起動。失敗としてカウントせず、
      // 新しい言語(getSpeechRecognitionLanguage()経由でbegin()が読み直す)ですぐに再開する
      isChangingLanguageRef.current = false;
      lastBeginReasonRef.current = "generic"; // 割り込みとは無関係の、意図的な再起動のため
      begin();
      return;
    }
    if (!shouldRun.current) {
      // endイベントが何らかの理由で二重に発火しても、確定済みのタイムラインを
      // 2回clearScreenStateで巻き戻したり、finalizeSessionDurationを2回走らせたりしない
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      // 録音用のオーディオセッション(playAndRecord)を解放し、再生時にBluetoothが切れないようにする
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      setRunning(false);
      finalizeOrDiscardEmptySession({ showComplete: true, clearAfter: true });
      return;
    }
    if (isAppBackgrounded()) {
      // バックグラウンド中(他アプリへの切替による音声セッション割り込みなど)のendは、
      // すぐに再起動しても失敗するだけなので、ここではリトライせず
      // フォアグラウンド復帰時にまとめて再開する(AppStateの変化を監視するuseEffect側で処理)
      return;
    }
    // 無音による正常な再起動(no-speech)は失敗として数えない。話者が黙っている時間が
    // 続くと本来は何も壊れていないのに再起動サイクルだけが積み上がり、failStreakが
    // 閾値を超えて録音が強制終了してしまっていたため、ここで区別する
    if (lastErrorWasNoSpeechRef.current) {
      lastErrorWasNoSpeechRef.current = false;
      scheduleRestart(NO_SPEECH_RETRY_DELAY_MS, "no-speech");
      return;
    }
    if (lastErrorWasInterruptedRef.current) {
      lastErrorWasInterruptedRef.current = false;
      scheduleRestart(INTERRUPTED_RETRY_DELAY_MS, "interrupted");
      return;
    }
    scheduleRestart(NO_SPEECH_RETRY_DELAY_MS, "generic");
  });

  const begin = () => {
    // audiostartイベントはネイティブ側の非同期処理を経て発火するため、begin()を呼んでから
    // 実際にisRecognizingRef.current=trueになるまでにわずかなギャップがある。その間に
    // (バックグラウンドの音声取り込み完了によるresumeExisting()側のbegin()や、AppStateの
    // 復帰イベントなど)別経路からもbegin()が呼ばれると、ネイティブの音声認識セッションが
    // 二重に立ち上がってしまい、「一時停止しても片方は止まらない」といった不具合につながる。
    // ここで同期的にフラグを立てることで、そのすり抜けを防ぐ
    if (isRecognizingRef.current) return;
    isRecognizingRef.current = true;

    // cache配下(既定値)だとOSに自動削除される恐れがあるため、documentDirectory配下を明示する
    let audioOutputDirectory: string | undefined;
    try {
      audioOutputDirectory = getAudioDirectoryUri();
    } catch (e) {
      console.warn("[FS] 音声保存ディレクトリの準備に失敗しました。既定のcacheに保存されます", e);
    }

    const useExternalicMic = getAllowBluetoothMic();

    ExpoSpeechRecognitionModule.start({
      lang: getSpeechRecognitionLanguage(),
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      recordingOptions: {
        persist: true,
        outputDirectory: audioOutputDirectory,
        outputSampleRate: getRecordingSampleRate(),
      },
      iosCategory: {
        category: "playAndRecord",
        categoryOptions: useExternalicMic ? ["defaultToSpeaker", "allowBluetooth"] : ["defaultToSpeaker"],
        mode: "default",          // ← measurement から変更。AGCが効くようになる
      },
      iosTaskHint: "dictation",    // ← 連続した話し言葉向けのヒント
      volumeChangeEventOptions: {
        enabled: true,
        intervalMillis: 100,
      },
    });

    // start()は戻り値のない投げっぱなしの呼び出しで、ネイティブ側の起動が実際に成功したかを
    // 直接は確認できない。他アプリがまだ音声セッションを離していない場合など、audiostartが
    // 一切発火しないまま(=対応する"end"も来ないまま)isRecognizingRefがtrueに固まってしまう
    // ケースがあるため、一定時間で見切りをつけて再試行する
    clearBeginWatchdog();
    beginWatchdogTimerRef.current = setTimeout(() => {
      beginWatchdogTimerRef.current = null;
      if (!isRecognizingRef.current) return; // 既に別経路(audiostart/end)で解消済みなら何もしない
      isRecognizingRef.current = false;
      if (!shouldRun.current) return;
      if (isAppBackgrounded()) return; // 通話・動画視聴などでバックグラウンド相当ならリトライしない
      // このbegin()呼び出しがinterrupted由来のリトライ連鎖の一部だった場合は、failStreakではなく
      // interruptedStreakとして数える(Duolingoのような断続的な割り込みで強制終了に至らないようにするため)
      if (lastBeginReasonRef.current === "interrupted") {
        scheduleRestart(INTERRUPTED_RETRY_DELAY_MS, "interrupted");
      } else {
        scheduleRestart(NO_SPEECH_RETRY_DELAY_MS, "generic"); // 実起動に失敗したとみなし、failStreakに加算する
      }
    }, BEGIN_WATCHDOG_TIMEOUT_MS);
  };

  const start = async () => {
    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!mic.granted) {
      push(t("record.log.micPermissionDenied"), "sys");
      return;
    }
    startedAt.current = Date.now();
    sessionStartedAtRef.current = startedAt.current;
    lastResultAt.current = Date.now();
    failStreak.current = 0;
    interruptedStreak.current = 0;
    lastBeginReasonRef.current = "generic";
    shouldRun.current = true;
    finalizedRef.current = false;
    setBlocks([]);
    setAudioUris([]);
    setRestarts(0);
    setRunning(true);

    const sessionId = genId();
    sessionIdRef.current = sessionId;
    lastBlockIdRef.current = null;
    audioSeqRef.current = 0;
    contentMsRef.current = 0;
    prevEnd.current = 0; // 前のセッションの値が新しいセッションに引き継がれてしまわないようにする
    segStart.current = null;
    sectionGapMsRef.current = getDefaultSectionGapMs();
    paragraphGapMsRef.current = getDefaultParagraphGapMs();
    sessionsRepo
      .create({
        id: sessionId,
        title: "",
        startedAt: sessionStartedAtRef.current,
        sectionGapMs: sectionGapMsRef.current,
        paragraphGapMs: paragraphGapMsRef.current,
      })
      .catch((e) => console.warn("[DB] セッションの作成に失敗しました", e));

    begin();
  };

  // クラッシュ復旧の「録音を再開する」から、既存セッションに続けて録音するためのエントリーポイント。
  // start()と違い、新規セッションは作らず、DB上の最後の状態から各種refを再構築してからbegin()を呼ぶ
  // (continuousモードの自動再起動・手動pause→resumeと同じ「既存のrefのままbegin()し直す」仕組みを踏襲)
  const resumeExisting = async (sessionId: string) => {
    setRestoring(true);
    const [session, existingBlocks] = await Promise.all([
      sessionsRepo.getById(sessionId),
      blocksRepo.listBySessionId(sessionId),
    ]);
    if (!session) {
      setRestoring(false);
      return;
    }

    // まず「これまでの記録」をすぐに画面に出す。孤児音声ファイルの取り込み(実尺取得のため
    // ファイルを読み込む必要があり、壊れたファイルだと数秒〜10秒ほどかかることがある)を
    // 先に待ってしまうと、タイムラインが復元されるまで画面が固まって見えてしまうため
    sessionIdRef.current = sessionId;
    sessionStartedAtRef.current = session.startedAt;
    sectionGapMsRef.current = session.sectionGapMs;
    paragraphGapMsRef.current = session.paragraphGapMs;

    const transcripts = existingBlocks
      .filter((b) => b.kind === "transcript")
      .sort((a, b) => a.startMs - b.startMs);
    const lastTranscript = transcripts[transcripts.length - 1] ?? null;
    lastBlockIdRef.current = lastTranscript?.id ?? null;
    prevEnd.current = lastTranscript ? lastTranscript.endMs ?? lastTranscript.startMs : 0;
    segStart.current = null;

    const restoredBlocks: Block[] = existingBlocks
      .filter((b) => b.kind === "transcript" || b.kind === "note")
      .sort((a, b) => a.startMs - b.startMs)
      .map((b) =>
        b.kind === "transcript"
          ? {
              id: b.id,
              ms: b.startMs,
              endMs: b.endMs ?? undefined,
              text: b.text ?? "",
              kind: "text",
              isStarred: b.isStarred,
              isTodo: b.isTodo,
              isQuestion: b.isQuestion,
            }
          : { id: b.id, ms: b.startMs, text: t("record.log.memo", { text: b.text ?? "" }), kind: "sys" }
      );
    setBlocks(restoredBlocks);
    setAudioUris([]);
    setRestarts(0);

    // 強制終了でDB未登録のまま残っている音声ファイルがあれば、ここで取り込んでおく
    // (offset_ms/seqの連続性を保つため、実際に録音を再開する前に済ませておく必要がある)。
    // ここで想定外の例外が出ても、復元自体は止めない
    try {
      await adoptOrphanAudioFiles(session);
    } catch (e) {
      console.warn("[FS] 孤児音声ファイルの取り込みに失敗しました", e);
    }
    const audioFiles = await audioFilesRepo.listBySessionId(sessionId).catch(() => []);
    audioSeqRef.current = audioFiles.reduce((max, f) => Math.max(max, f.seq), -1) + 1;
    // audio_filesの尺の合計 = これまでに実際に録音された音声の累積時間(offsetMsの連続性と同じ考え方)。
    // 音声ファイルの取り込みに失敗した場合でも、少なくとも最後のブロックのendMsまでは
    // 実際に時間が経過していたはずなので、それを下限にする(経過時間表示が0に戻らないように)
    const audioContentMs = audioFiles.reduce((sum, f) => sum + f.durationMs, 0);
    // 文字起こしが1件も確定していないまま強制終了したセッションだとprevEnd.currentが0のままなので、
    // 再開後の最初の発言(interimを経由せずfinalが来た場合、開始時刻はprevEnd.currentにフォールバックする)
    // が00:00で記録されてしまう。ここで音声の実測累積時間まで引き上げておく
    prevEnd.current = Math.max(prevEnd.current, audioContentMs);
    contentMsRef.current = Math.max(audioContentMs, prevEnd.current);
    // running=falseの間はティッカーのuseEffectが動かず経過時間表示が更新されないため、
    // ここで明示的に反映しておく(そうしないと「開始」を押すまでヘッダーの秒数だけ
    // 00:00のままになり、復元済みログの時刻と食い違って見えてしまう)
    setElapsedMs(contentMsRef.current);

    // ここではまだマイクを起動しない。「復元中…」を終え「待機中」に戻し、
    // ユーザーが明示的に「開始」を押した時点で初めてbeginPendingResume()が録音を始める
    pendingResumeSessionIdRef.current = sessionId;
    setRestoring(false);
  };

  // 復元済みセッションについて、ユーザーが「開始」を押した時に初めて呼ばれる。
  // start()と違いsessionIdRef等は既にresumeExisting()で設定済みのため、マイク権限を
  // 確認してbegin()するだけでよい
  const beginPendingResume = async () => {
    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!mic.granted) {
      push(t("record.log.micPermissionDenied"), "sys");
      return;
    }
    pendingResumeSessionIdRef.current = null;

    // startedAt.currentは通常audiostartイベントで設定されるが、begin()呼び出しから
    // 実際にaudiostartが発火するまでの間もrunning=trueになり経過時間の計算
    // (Date.now() - startedAt.current)が走る。ここで設定せずにいると、前回値
    // (このセッションでは一度も設定されておらずuseRef(0)のまま)が使われ、
    // Date.now() - 0 という巨大な値が一瞬表示されてしまう
    startedAt.current = Date.now();
    lastResultAt.current = Date.now();
    failStreak.current = 0;
    interruptedStreak.current = 0;
    lastBeginReasonRef.current = "generic";
    shouldRun.current = true;
    finalizedRef.current = false;
    setRunning(true);

    begin();
  };

  // Record画面が resumeSessionId 付きで開かれたら再開処理を走らせる。同じセッションIDに対しては
  // 1回だけ、別のセッションIDが来たら(前の再開処理の状態にかかわらず)改めて再開処理を走らせる
  useEffect(() => {
    const resumeSessionId = route.params?.resumeSessionId;
    if (!resumeSessionId || resumeHandledSessionIdRef.current === resumeSessionId) return;
    resumeHandledSessionIdRef.current = resumeSessionId;
    resumeExisting(resumeSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.resumeSessionId]);

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
    // begin()呼び出しから実際にaudiostartが発火するまでの間もrunning=true・paused=falseで
    // 経過時間のティッカーが動くため、ここで先に実時刻を入れておく(入れないと一時停止前の
    // 古いstartedAt.currentがそのまま使われ、一時停止していた時間分が一瞬上乗せされて見える)
    startedAt.current = Date.now();
    interruptedStreak.current = 0;
    lastBeginReasonRef.current = "generic";
    begin(); // audiostartで改めて更新され、経過時間はcontentMsRefからの続きとして計測される
  };

  // 一時停止中は音声認識が既に止まっているため、endイベントを待たずにここで終了処理を行う
  const endSession = () => {
    if (paused) {
      shouldRun.current = false;
      setPaused(false);
      setRunning(false);
      finalizeOrDiscardEmptySession({ showComplete: true, clearAfter: true });
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
        interruptedStreak.current = 0;
        lastBeginReasonRef.current = "generic";
        begin();
      }
    });
    return () => sub.remove();
  }, []);

  // アンマウント時に、稼働中のwatchdog/受動リトライタイマーを止める
  // (setIntervalであるpassiveRetryTimerRefは、setTimeoutの各種リトライと違い放置すると残り続けるため)
  useEffect(() => {
    return () => {
      clearBeginWatchdog();
      clearPassiveRetryTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        toggleQuestionOnLastBlock();
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
      toggleBlockQuestion(block);
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

  // 長押しメニューの対象ブロックと、メニュー項目。データは常に最新のblocksから引き直す
  const menuBlockId = rowMenu.anchor?.data ?? null;
  const menuBlock = menuBlockId ? blocks.find((b) => b.id === menuBlockId) ?? null : null;

  type IconName = keyof typeof Ionicons.glyphMap;
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
          activeColor: colors.star.accent,
          inactiveBg: colors.star.background,
          onPress: () => toggleBlockStar(menuBlock),
        },
        {
          key: "todo",
          icon: "checkmark",
          active: !!menuBlock.isTodo,
          activeColor: colors.todo.accent,
          inactiveBg: colors.todo.background,
          onPress: () => toggleBlockTodo(menuBlock),
        },
        {
          key: "question",
          icon: "help-circle",
          active: !!menuBlock.isQuestion,
          activeColor: colors.question.accent,
          inactiveBg: colors.question.background,
          onPress: () => toggleBlockQuestion(menuBlock),
        },
      ]
    : [];

  // RowLongPressMenuのitemsは1本のリストなので、テキスト編集/メモ/写真/削除を1つにまとめる
  const menuItems: RowMenuItem[] = menuBlock
    ? [
        {
          key: "edit",
          label: t("record.menu.editText"),
          icon: "create-outline",
          color: "#8e8e93",
          onPress: () => startEditingBlock(menuBlock),
        },
        {
          key: "memo",
          label: t("record.menu.addMemo"),
          icon: "document-text-outline",
          color: "#8e8e93",
          onPress: () => {
            rowMenu.close();
            setMemoModalVisible(true);
          },
        },
        {
          key: "photo",
          label: t("record.menu.addPhoto"),
          icon: "camera-outline",
          color: "#8e8e93",
          onPress: () => {
            rowMenu.close();
            handlePhotoCapture();
          },
        },
        {
          key: "delete",
          label: t("common.delete"),
          icon: "trash-outline",
          color: colors.danger.action,
          onPress: () => confirmDeleteBlock(menuBlock),
        },
      ]
    : [];
  const MENU_ATTR_ROW_HEIGHT = 48;

  // 「↓ 新着N件」バッジ用: 一時停止中に増えた発言ブロックの件数
  const textBlockCount = blocks.filter((b) => b.kind === "text").length;
  const newArrivalCount = scrollPaused ? Math.max(0, textBlockCount - pauseBaselineCountRef.current) : 0;
  // 増えた分もまだ表示領域に収まっている(=スクロールしなくても見えている)場合は、
  // バッジを出す必要がない
  const transcriptOverflowing = transcriptContentHeight > transcriptViewportHeight;

  if (sleepMode) {
    const sleepLines = blocks.filter((b) => b.kind === "text");
    const sleepItems: SleepDisplayItem[] = [
      ...(interim ? [{ key: "interim", kind: "interim" as const, text: interim }] : []),
      ...[...sleepLines].reverse().map((b, i) => ({
        key: b.id ?? `sleep-${sleepLines.length - 1 - i}`,
        kind: "block" as const,
        block: b,
        active: i === 0 && !interim,
      })),
    ];
    return (
      <SafeAreaView style={[styles.container, styles.sleepContainer]} edges={["top"]}>
        <Pressable
          style={styles.sleepOverlay}
          onPressIn={handleSleepWakePressIn}
          onPressOut={handleSleepWakePressOut}
        >
          <View style={styles.sleepHeader}>
            <View style={styles.sleepStatusRow}>
              <View style={[styles.sleepDot, !(running && !paused) && styles.sleepDotIdle]} />
              <Text style={styles.sleepStatusLabel}>
                {paused ? t("record.status.paused") : running ? t("record.status.recording") : t("record.status.idle")}
              </Text>
              <Text style={styles.sleepStatusTimer}>{fmt(elapsedMs)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSleepMode(false);
              }}
              hitSlop={10}
            >
              <Ionicons name="moon" size={20} color="#c7c7cc" />
            </TouchableOpacity>
          </View>

          <FlatList
            ref={sleepScrollRef}
            style={styles.sleepTimeline}
            contentContainerStyle={styles.sleepTimelineContent}
            showsVerticalScrollIndicator={false}
            inverted
            data={sleepItems}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => {
              if (item.kind === "interim") {
                return <Text style={[styles.sleepLine, styles.sleepLineActive]}>{item.text}</Text>;
              }
              const badges = recordBlockBadges(item.block);
              return (
                <View style={styles.sleepLineRow}>
                  {badges.map((badge) => (
                    <Ionicons key={badge.key} name={badge.icon} size={13} color={badge.color} />
                  ))}
                  <Text style={[styles.sleepLine, item.active && styles.sleepLineActive]}>
                    {fmt(item.block.ms)}　{item.block.text}
                  </Text>
                </View>
              );
            }}
          />
        </Pressable>

        {/* ボタン行は「長押しで閉じる」Pressableの外(兄弟要素)に置く。Pressable配下に
            TouchableOpacityをネストすると端末によってはタップが親Pressableにも伝わり、
            ボタン操作と同時にスリープ解除の長押しが走って意図した動作(撮影など)が阻害されるため */}
        <View style={styles.sleepBottomRow}>
          <View style={styles.sleepButtonGroup}>
            <TouchableOpacity
              style={[styles.sleepActionButton, restoring && styles.sleepActionButtonDisabled]}
              activeOpacity={0.7}
              onPress={
                paused ? resume : running ? pause : pendingResumeSessionIdRef.current ? beginPendingResume : start
              }
              disabled={restoring}
              hitSlop={8}
            >
              {restoring ? (
                <ActivityIndicator size="small" color="#8e8e93" />
              ) : (
                <Ionicons name={running && !paused ? "pause" : "play"} size={16} color="#e5e5ea" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sleepActionButton, !running && styles.sleepActionButtonDisabled]}
              activeOpacity={0.7}
              onPress={endSession}
              disabled={!running}
              hitSlop={8}
            >
              <Ionicons name="square" size={14} color={colors.danger.action} />
            </TouchableOpacity>
          </View>

          <View style={styles.sleepButtonGroup}>
            <TouchableOpacity
              style={styles.sleepActionButton}
              activeOpacity={0.7}
              onPress={() => handleMarkPress("star")}
              hitSlop={8}
            >
              <Ionicons name="star" size={16} color={colors.star.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sleepActionButton}
              activeOpacity={0.7}
              onPress={() => handleMarkPress("photo")}
              hitSlop={8}
            >
              <Ionicons name="camera" size={16} color="#c7c7cc" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 長押し中だけ徐々に明るくなる層。ヘッダー・タイムライン・下部ボタン行を含む画面全体に
            重ねることで、解除にどれだけ近づいたかを一体感のある明るさで示す。タッチを奪わないよう
            pointerEvents="none" にしてボタン操作を妨げない */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sleepWakeBrighten,
            { opacity: sleepWakeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }) },
          ]}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topSection}>
        <View style={styles.topLeftGroup}>
          <HeaderEqualizer running={running && !paused && !bandExpanded} />
        </View>

        <View style={styles.topRightGroup}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setSleepMode(true);
            }}
            hitSlop={10}
          >
            <Ionicons name="moon-outline" size={20} color="#8e8e93" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate("HowToUse", { section: "record" })}
            hitSlop={10}
          >
            <Ionicons name="help-circle-outline" size={22} color="#8e8e93" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDebug(true)} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color="#8e8e93" />
          </TouchableOpacity>
        </View>

        <View style={styles.statusRow}>
          {restoring ? (
            <ActivityIndicator size="small" color="#8e8e93" style={styles.statusSpinner} />
          ) : (
            <View style={[styles.recordingDot, !(running && !paused) && styles.recordingDotIdle]} />
          )}
          <Text style={styles.statusLabel}>
            {restoring
              ? restoringLabel
              : paused
              ? t("record.status.paused")
              : running
              ? t("record.status.recording")
              : t("record.status.idle")}
          </Text>
          <Text style={styles.statusTimer}>{fmt(elapsedMs)}</Text>
        </View>
      </View>

      <View style={styles.transcriptWrap}>
      {bandExpanded ? (
        <View style={styles.expandedEqualizerOverlay} pointerEvents="box-none">
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setBandExpanded(false);
            }}
          >
            <ExpandedFocusEqualizer running={running && !paused} />
          </TouchableOpacity>
        </View>
      ) : null}
      {markSelectMode ? (
        <View style={styles.markSelectBannerContainer} pointerEvents="box-none">
          <View style={styles.markSelectBanner}>
            <Text style={styles.markSelectBannerText}>
              {markSelectMode === "star"
                ? t("record.markSelect.star")
                : markSelectMode === "todo"
                ? t("record.markSelect.todo")
                : t("record.markSelect.question")}
            </Text>
            <TouchableOpacity onPress={cancelMarkSelectMode} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {scrollPaused && newArrivalCount > 0 && transcriptOverflowing ? (
        <View style={styles.followBadgeContainer} pointerEvents="box-none">
          <TouchableOpacity style={styles.followBadge} activeOpacity={0.85} onPress={resumeAutoScroll}>
            <Ionicons name="arrow-down" size={13} color="#fff" />
            <Text style={styles.followBadgeText}>{t("record.newArrival", { count: newArrivalCount })}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
        // テキスト編集中のキャンセル/完了ボタンが、キーボード表示中は1回目のタップで
        // キーボードを閉じるだけになってしまい2回押す必要が生じる問題を防ぐ
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => setTranscriptViewportHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => {
          setTranscriptContentHeight(h);
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
                    {t("record.section.header", { index: sectionIndex + 1, range: rangeText })}
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
                ? recordRowSpacingFor(section.blocks[blockIndexInSection - 1], b, paragraphGapMsRef.current)
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
                      <Text style={styles.editActionButtonText}>{t("common.cancel")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editActionButton, styles.editActionButtonPrimary]}
                      onPress={commitBlockEdit}
                    >
                      <Text style={styles.editActionButtonPrimaryText}>{t("common.done")}</Text>
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
                  ref={b.id ? rowMenu.registerRef(b.id) : undefined}
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
            {running ? t("record.hint.running") : t("record.hint.idle")}
          </Text>
        ) : null}
        {!running && audioUris.length === 1 ? (
          <Playback uri={audioUris[0]} blocks={blocks} leadSec={leadSec} />
        ) : null}
      </ScrollView>
      </View>

      <LiveFocusBand
        text={interim}
        running={running && !paused}
        expanded={bandExpanded}
        onToggleExpanded={() => setBandExpanded((prev) => !prev)}
      />

      <View style={styles.bottomSection}>
        <View style={styles.bottomCard}>
          <View style={styles.tileRow}>
            {MARK_TILES.map((tile) => (
              <MarkTile
                key={tile.key}
                tile={{ ...tile, label: t(tile.labelKey) }}
                active={activeMark === tile.key}
                onPress={handleMarkPress}
                onLongPress={startMarkSelectMode}
              />
            ))}
          </View>

          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.controlButtonReset, (!running || restoring) && styles.controlButtonDisabled]}
              onPress={handleReset}
              disabled={!running || restoring}
              activeOpacity={0.75}
              hitSlop={6}
            >
              <Ionicons name="refresh" size={18} color="#8e8e93" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButtonPause, restoring && styles.controlButtonDisabled]}
              onPress={paused ? resume : running ? pause : pendingResumeSessionIdRef.current ? beginPendingResume : start}
              disabled={restoring}
              activeOpacity={0.75}
            >
              {restoring ? (
                <ActivityIndicator size="small" color="#8e8e93" />
              ) : (
                <Ionicons name={running && !paused ? "pause" : "play"} size={18} color="#1c1c1e" />
              )}
              <Text style={styles.controlButtonPauseText}>
                {restoring
                  ? restoringLabel
                  : paused
                  ? t("record.button.resume")
                  : running
                  ? t("record.button.pause")
                  : t("record.button.start")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButtonStop, !running && styles.controlButtonDisabled]}
              onPress={endSession}
              disabled={!running}
              activeOpacity={0.75}
            >
              <Ionicons name="square" size={14} color="#fff" />
              <Text style={styles.controlButtonStopText}>{t("record.button.stop")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal visible={showDebug} animationType="slide" transparent onRequestClose={() => setShowDebug(false)}>
        <Pressable style={styles.debugOverlay} onPress={() => setShowDebug(false)}>
          <Pressable style={styles.debugPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.debugTitle}>{t("record.debug.title")}</Text>
            <Text style={styles.mono}>{diag}</Text>
            <Text style={styles.mono}>
              {t("record.debug.restartsAndFiles", { restarts, count: audioUris.length })}
            </Text>
            <View style={styles.debugLeadRow}>
              <Text style={styles.debugLeadLabel}>{t("record.debug.leadSeconds", { sec: leadSec.toFixed(1) })}</Text>
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
              <Text style={styles.pillButtonText}>{t("record.debug.showRawLog")}</Text>
            </TouchableOpacity>
            <ScrollView style={styles.debugLogScroll}>
              <Text style={styles.mono}>{showLog}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.pillButton, styles.pillButtonPrimary]}
              onPress={() => setShowDebug(false)}
            >
              <Text style={[styles.pillButtonText, styles.pillButtonTextPrimary]}>{t("common.close")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
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
              <Text style={styles.debugTitle}>{t("record.memoModal.title")}</Text>
              <TextInput
                style={[styles.promptInput, styles.promptInputMultiline]}
                value={memoInput}
                onChangeText={setMemoInput}
                placeholder={t("record.memoModal.placeholder")}
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
                  <Text style={styles.pillButtonText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pillButton, styles.pillButtonPrimary]}
                  onPress={confirmMemo}
                >
                  <Text style={[styles.pillButtonText, styles.pillButtonTextPrimary]}>{t("common.save")}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <RowLongPressMenu
        anchor={menuBlock ? rowMenu.anchor : null}
        scale={rowMenu.scale}
        items={menuItems}
        onClose={closeBlockMenu}
        extraHeight={MENU_ATTR_ROW_HEIGHT}
        renderPreview={() =>
          menuBlock ? (
            <View style={styles.menuHighlightRow}>
              <Text style={styles.transcriptTime}>{fmt(menuBlock.ms)}</Text>
              <Text style={styles.transcriptText} numberOfLines={4}>
                {menuBlock.text}
              </Text>
            </View>
          ) : null
        }
        extra={
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
        }
      />
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

// ヘッダー左上に表示する音量イコライザー(LiveFocusBandの円形イコライザーと同じ仕組みで、
// バーの本数だけ増やしたもの)。
function HeaderEqualizer({ running }: { running: boolean }) {
  const [levels, setLevels] = useState<number[]>(new Array(HEADER_EQ_BAR_COUNT).fill(3));
  const currentRef = useRef<number[]>(new Array(HEADER_EQ_BAR_COUNT).fill(3));
  const weightRef = useRef<number[]>(new Array(HEADER_EQ_BAR_COUNT).fill(1));

  useEffect(() => {
    if (!running) {
      currentRef.current = new Array(HEADER_EQ_BAR_COUNT).fill(3);
      weightRef.current = new Array(HEADER_EQ_BAR_COUNT).fill(1);
      setLevels(currentRef.current);
    }
  }, [running]);

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (!running) return;
    const clamped = Math.max(-2, Math.min(10, event.value));
    const normalized = (clamped + 2) / 12;
    const nextLevels = HEADER_EQ_BAR_SCALE.map((scale, i) => {
      if (Math.random() < 0.5) {
        const drift = (Math.random() - 0.5) * 0.3;
        weightRef.current[i] = Math.max(0.5, Math.min(1.6, weightRef.current[i] + drift));
      }
      const noise = (Math.random() - 0.5) * 3 * normalized;
      const spike = Math.random() < 0.08 ? Math.random() * 3 * normalized : 0;
      const target = 3 + normalized * 10 * scale * weightRef.current[i] + noise + spike;
      const smoothing = HEADER_EQ_BAR_SMOOTHING[i];
      const current = currentRef.current[i] + (target - currentRef.current[i]) * smoothing;
      const clampedCurrent = Math.max(3, Math.min(16, current));
      currentRef.current[i] = clampedCurrent;
      return Math.round(clampedCurrent);
    });
    setLevels(nextLevels);
  });

  if (!running) return null;

  return (
    <View style={styles.headerEqualizer}>
      {levels.map((h, i) => (
        <View key={i} style={[styles.headerEqualizerBar, { height: h }]} />
      ))}
    </View>
  );
}

// ヘッダー左上に表示する音量ゲージ付きマイクアイコン(液面ゲージ式)。
// mic-outline(薄グレー)を土台に、mic(黒塗り)を音量に応じた高さでマスクして重ね、
// 音量が大きいほど黒く塗りつぶされる量が増えるように見せている。
function MiniMicIcon({ running }: { running: boolean }) {
  const [micLevel, setMicLevel] = useState(0);
  const micLevelRef = useRef(0);

  useEffect(() => {
    if (!running) {
      micLevelRef.current = 0;
      setMicLevel(0);
    }
  }, [running]);

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (!running) return;
    // eventのvalueは概ね-2〜10の範囲(0未満は無音相当)。0〜1に正規化する
    const clamped = Math.max(-2, Math.min(10, event.value));
    const normalized = (clamped + 2) / 12;
    micLevelRef.current = micLevelRef.current + (normalized - micLevelRef.current) * 0.3;
    setMicLevel(micLevelRef.current);
  });

  if (!running) return null;

  const fillHeight = Math.max(2, Math.round(2 + micLevel * 14));

  return (
    <View style={styles.miniMicIcon}>
      <Ionicons name="mic-outline" size={16} color="#c7c7cc" />
      <View style={[styles.miniMicFillMask, { height: fillHeight }]}>
        <Ionicons name="mic" size={16} color="#1c1c1e" style={styles.miniMicFillIcon} />
      </View>
    </View>
  );
}

// 展開時に画面上部へ浮かぶ円形イコライザー。バーの動きに加え、円の背景自体もマイク
// アイコン(MiniMicIcon)と同じ液面ゲージ式で、音量に応じて下から明るく塗りつぶす。
// LiveFocusBandの展開パネルの中ではなく、画面全体に重なるオーバーレイとして独立して描画する。
function ExpandedFocusEqualizer({ running }: { running: boolean }) {
  // 音量バー用のレベル(volumechangeイベントの実測値をもとに更新)。
  // 音声認識からは周波数帯域別のデータ(低音/高音)は取得できず、音量値1つしか
  // 得られないため、本物のイコライザーではなく擬似的な演出として、バーごとに
  // 「反応の強さ(weight)」と「反応の速さ(smoothing)」を変えて個性を出している。
  // weightは時々少しだけランダムに揺らすことで、同じ音量でも毎回微妙に違う動きに見せる。
  const [circleLevels, setCircleLevels] = useState<number[]>(
    new Array(LIVE_FOCUS_BAR_COUNT).fill(4)
  );
  const barCurrentRef = useRef<number[]>(new Array(LIVE_FOCUS_BAR_COUNT).fill(4));
  const barWeightRef = useRef<number[]>(new Array(LIVE_FOCUS_BAR_COUNT).fill(1));

  // 円の液面ゲージ(下からの塗りつぶし)用。0〜1に正規化した音量を滑らかに追従させる
  const [fillLevel, setFillLevel] = useState(0);
  const fillLevelRef = useRef(0);

  useEffect(() => {
    if (!running) {
      barCurrentRef.current = new Array(LIVE_FOCUS_BAR_COUNT).fill(4);
      barWeightRef.current = new Array(LIVE_FOCUS_BAR_COUNT).fill(1);
      setCircleLevels(barCurrentRef.current);
      fillLevelRef.current = 0;
      setFillLevel(0);
    }
  }, [running]);

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (!running) return;
    // eventのvalueは概ね-2〜10の範囲(0未満は無音相当)。既存のバー高さレンジ(4〜22、コンテナの高さまで)に写像する
    const clamped = Math.max(-2, Math.min(10, event.value));
    const normalized = (clamped + 2) / 12;

    fillLevelRef.current = fillLevelRef.current + (normalized - fillLevelRef.current) * 0.3;
    setFillLevel(fillLevelRef.current);

    const nextLevels = LIVE_FOCUS_BAR_SCALE.map((scale, i) => {
      // バーごとの「個性」を少し大きめにランダムドリフトさせる
      if (Math.random() < 0.5) {
        const drift = (Math.random() - 0.5) * 0.3;
        barWeightRef.current[i] = Math.max(0.5, Math.min(1.6, barWeightRef.current[i] + drift));
      }
      // 音が鳴っているときほど揺らぎを大きくするノイズ(無音時は静かなまま)
      const noise = (Math.random() - 0.5) * 6 * normalized;
      // ごく低確率でどこかのバーが一瞬大きく跳ねる
      const spike = Math.random() < 0.08 ? Math.random() * 6 * normalized : 0;
      const target = 4 + normalized * 14 * scale * barWeightRef.current[i] + noise + spike;
      const smoothing = LIVE_FOCUS_BAR_SMOOTHING[i];
      const current = barCurrentRef.current[i] + (target - barCurrentRef.current[i]) * smoothing;
      const clampedCurrent = Math.max(4, Math.min(22, current));
      barCurrentRef.current[i] = clampedCurrent;
      return Math.round(clampedCurrent);
    });
    setCircleLevels(nextLevels);
  });

  if (!running) return null;

  return (
    <View style={styles.liveFocusCircle}>
      <View style={styles.liveFocusCircleInner}>
        <View style={[styles.liveFocusCircleFill, { height: Math.round(fillLevel * 88) }]} />
        <View style={styles.liveFocusCircleBars}>
          {circleLevels.map((h, i) => (
            <View key={i} style={[styles.liveFocusBar, { height: h }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

// 収録中の「今聞き取っている内容」を表示する帯(チャットアプリの「入力中」表示のように、確定済みタイムラインの直後・操作ボタンの直前に置く)。
// 縮小(1行)⇄展開(3行までのテキスト)はタップで切り替える。展開中の円形イコライザーは
// 画面上部に浮かぶオーバーレイ(ExpandedFocusEqualizer)として別途描画されるため、
// 展開状態(expanded)は親(RecordScreen)で管理し、ここは制御コンポーネントとして受け取る
// (オーバーレイをタップした時にも同じ状態を閉じられるようにするため)。
function LiveFocusBand({
  text,
  running,
  expanded,
  onToggleExpanded,
}: {
  text: string;
  running: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onToggleExpanded();
  };

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
          <Text style={styles.liveFocusTextExpanded} numberOfLines={3} ellipsizeMode="head">
            {text}
          </Text>
        ) : (
          <View style={styles.liveFocusRow}>
            <MiniMicIcon running={running} />
            <Text style={styles.liveFocusTextCollapsed} numberOfLines={1} ellipsizeMode="head">
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

  // スリープモード(Claude Design案 1c)
  sleepContainer: { backgroundColor: "#000000" },
  sleepOverlay: { flex: 1, paddingHorizontal: 20 },
  sleepWakeBrighten: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ffffff",
  },
  sleepHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  sleepStatusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sleepDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.danger.action },
  sleepDotIdle: { backgroundColor: "#5a5a5e" },
  sleepStatusLabel: { fontSize: 13, color: "#8e8e93", fontWeight: "600" },
  sleepStatusTimer: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    color: "#c7c7cc",
  },
  sleepTimeline: {
    flex: 1,
  },
  sleepTimelineContent: {
    paddingTop: 28,
    gap: 10,
  },
  sleepLineRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  sleepLine: { flex: 1, fontSize: 14, lineHeight: 20, color: "rgba(255,255,255,0.28)" },
  sleepLineActive: { color: "rgba(255,255,255,0.82)" },
  sleepBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  sleepButtonGroup: { flexDirection: "row", alignItems: "center", gap: 14 },
  sleepActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  sleepActionButtonDisabled: { opacity: 0.35 },

  topRightGroup: {
    position: "absolute",
    top: 0,
    right: 16,
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  topLeftGroup: {
    position: "absolute",
    top: 0,
    left: 16,
    zIndex: 1,
    height: 22,
    justifyContent: "center",
  },
  headerEqualizer: { flexDirection: "row", alignItems: "center", gap: 2, height: 16 },
  headerEqualizerBar: { width: 2, borderRadius: 1, backgroundColor: "#9c9ca3" },

  // 展開中の円形イコライザーを、ログ表示エリア(transcriptWrap)の最上部に浮かせて
  // 表示するオーバーレイ。ヘッダーの秒数表示と被らないよう、ヘッダーより下から始める
  // (タップは下の要素に通すためpointerEvents="none")
  expandedEqualizerOverlay: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    zIndex: 6,
    alignItems: "center",
  },

  topSection: { alignItems: "center", paddingTop: 10, paddingBottom: 4 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger.action },
  recordingDotIdle: { backgroundColor: "#b8b8bd" },
  statusSpinner: { width: 8, height: 8 },
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
    borderTopColor: colors.divider,
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
  // 録音中はノールックで読む場面があるため、他画面の本文(fontSize.body)より意図的に大きい
  transcriptText: { fontSize: fontSize.liveCaption, color: "#1c1c1e", flex: 1, lineHeight: 22 },
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
  sysText: { fontSize: 12, color: colors.danger.text, marginBottom: 8 },
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

  // 長押しメニュー(共通コンポーネントRowLongPressMenuの中で使うプレビュー・追加行の見た目)
  menuHighlightRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  menuAttrRow: { flexDirection: "row", height: 48 },
  menuAttrButton: { flex: 1, alignItems: "center", justifyContent: "center" },
  menuAttrButtonDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
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
    backgroundColor: colors.divider,
    marginBottom: 10,
  },
  liveFocusCollapsed: {
    width: "100%",
    paddingBottom: 8,
  },
  liveFocusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  miniMicIcon: { width: 16, height: 16, overflow: "hidden" },
  miniMicFillMask: { position: "absolute", left: 0, bottom: 0, width: 16, overflow: "hidden" },
  miniMicFillIcon: { position: "absolute", left: 0, bottom: 0 },
  liveFocusTextCollapsed: { flex: 1, fontSize: 13, color: "#a0a0a6" },

  liveFocusExpanded: {
    width: "100%",
    paddingBottom: 8,
    alignItems: "flex-start",
    gap: 12,
  },
  // 影(shadow)はoverflow:"hidden"だと切れてしまうため、影を持つ外側と
  // 塗りつぶしをクリップする内側(liveFocusCircleInner)を分けている
  liveFocusCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  liveFocusCircleInner: {
    flex: 1,
    borderRadius: 44,
    backgroundColor: "#1c1c1e",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  liveFocusCircleFill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(156,156,163,0.55)",
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
    textAlign: "left",
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
  controlButtonReset: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eceef1",
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
    backgroundColor: colors.danger.action,
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
    backgroundColor: colors.overlay.prompt,
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
  const { t } = useTranslation();
  const player = useAudioPlayer({ uri });

  return (
    <View style={styles.playbackCard}>
      <View style={styles.playbackHeaderRow}>
        <TouchableOpacity
          style={styles.playbackMiniButton}
          activeOpacity={0.7}
          onPress={async () => {
            await player.seekTo(0);
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
          <Text style={styles.playbackMetaText}>
            {t("record.playback.duration", { sec: Math.round(player.duration ?? 0) })}
          </Text>
          <Text style={styles.playbackMetaText}>
            {t("record.playback.leadFrom", { sec: leadSec.toFixed(1) })}
          </Text>
        </View>
      </View>

      <Text style={styles.playbackListLabel}>{t("record.playback.tapToPlay")}</Text>
      {blocks
        .filter((b) => b.kind === "text")
        .map((b, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.6}
            style={styles.transcriptRow}
            onPress={async () => {
              await player.seekTo(Math.max(0, b.ms / 1000 - leadSec));
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
