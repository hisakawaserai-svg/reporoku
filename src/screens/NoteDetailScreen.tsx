import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as ImagePicker from "expo-image-picker";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as blocksRepo from "../db/repositories/blocks";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import * as sessionsRepo from "../db/repositories/sessions";
import type { AudioFile, Block, Session } from "../db/types";
import { resolveAudioPosition } from "../utils/audioTimeline";
import { genId } from "../utils/id";
import { deleteStoredFile, persistPhotoFile } from "../utils/files";
import PhotoViewerModal from "../components/PhotoViewerModal";
import * as Clipboard from "expo-clipboard";
import { getSectionGroupingEnabled, setSectionGroupingEnabled } from "../utils/settings";

type FilterKey = "all" | "star" | "todo" | "question" | "photo" | "note";

const FILTERS: { key: FilterKey; label?: string; icon?: IconName; bg?: string; tint?: string }[] = [
  { key: "all", label: "すべて" },
  { key: "star", label: "★", bg: "#fdf0dc", tint: "#d98c00" },
  { key: "todo", label: "✓", bg: "#e0f7e6", tint: "#1f9254" },
  { key: "question", label: "?", bg: "#f2e8fc", tint: "#7c4dff" },
  { key: "photo", icon: "camera-outline", bg: "#eef1f4", tint: "#57575c" },
  { key: "note", icon: "document-text-outline", bg: "#f5ecdd", tint: "#8a6d3b" },
];

const LEAD_SEC = 1.2;

// タイムラインのセクション分けに使う閾値(ミリ秒)。後で調整しやすいようここにまとめておく。
// 「間」は前のブロックの推定終了時刻(startMs + 推定継続時間)から次のブロックのstartMsまでの差。
// セクションの閾値(旧SECTION_GAP_MS)はノートごとにsessions.section_gap_msとして持つようになったため、
// ここには「新しい発言として改行するかどうか」の段落閾値と、スライダーの可動範囲だけを残す
const PARAGRAPH_GAP_MS = 1500; // これ未満: 同じ段落として改行なしで自然に繋げて表示する
const SECTION_GAP_MIN_MS = 2000; // スライダーの下限(細かく分ける)
const SECTION_GAP_MAX_MS = 8000; // スライダーの上限(まとめる)
const SECTION_GAP_STEP_MS = 500;
const SECTION_GAP_FALLBACK_MS = 5000; // sessionsに値が無い場合のフォールバック

// 1文字あたりの推定発話時間(ミリ秒)。block.endMs(実測の発話終了時刻)が無い古いデータの
// フォールバックとしてのみ使う、テキスト長からのおおまかな発話継続時間の見積もり
const MS_PER_CHAR = 150;

// 発言(transcriptブロック)の推定継続時間。メモ・写真は瞬間的なイベントとして扱い0とする
function estimateBlockDurationMs(block: Block): number {
  if (block.kind !== "transcript" || !block.text) return 0;
  return block.text.length * MS_PER_CHAR;
}

// 前のブロックの終了時刻から次のブロックの開始時刻までの「間」(ミリ秒、負値は0に丸める)。
// 長い発言ほど文字数からの推定が外れやすいため、実測のendMsがあれば必ずそちらを優先する
function gapMsBetween(prev: Block, next: Block): number {
  const prevEndMs = prev.endMs ?? prev.startMs + estimateBlockDurationMs(prev);
  return Math.max(0, next.startMs - prevEndMs);
}

function fmt(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatHHMM(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMinutes(durationMs: number): string {
  return `${Math.round(durationMs / 60000)}分`;
}

function defaultTitle(session: Session): string {
  const d = new Date(session.startedAt);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")} の記録`;
}

function matchesFilter(block: Block, filter: FilterKey): boolean {
  switch (filter) {
    case "star":
      return block.isStarred;
    case "todo":
      return block.isTodo;
    case "question":
      return block.isQuestion;
    case "photo":
      return block.kind === "photo";
    case "note":
      return block.kind === "note";
    default:
      return true;
  }
}

type TimelineGroup = { key: string; blocks: Block[] };

function groupByGap(blocks: Block[], sectionGapMs: number): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    if (!prev || gapMsBetween(prev, block) >= sectionGapMs) {
      groups.push({ key: block.id, blocks: [block] });
    } else {
      groups[groups.length - 1].blocks.push(block);
    }
  });
  return groups;
}

// セクション内でのブロック同士の行間隔。「間」が短いほど、同じ段落として詰めて表示する
type RowSpacing = "paragraph" | "line";
function rowSpacingFor(prev: Block | undefined, block: Block): RowSpacing {
  if (!prev) return "line";
  return gapMsBetween(prev, block) < PARAGRAPH_GAP_MS ? "paragraph" : "line";
}

// 指定したブロックが属するセクション(グループ)のkeyを探す
function findSectionKeyForBlock(groups: TimelineGroup[], blockId: string): string | null {
  for (const g of groups) {
    if (g.blocks.some((b) => b.id === blockId)) return g.key;
  }
  return null;
}

function formatSectionRange(blocks: Block[], session: Session | null): string {
  if (!session || blocks.length === 0) return "";
  const start = formatHHMM(session.startedAt + blocks[0].startMs);
  const end = formatHHMM(session.startedAt + blocks[blocks.length - 1].startMs);
  return start === end ? start : `${start} 〜 ${end}`;
}

type IconName = keyof typeof Ionicons.glyphMap;

function kindMeta(block: Block): { color: string; label: string | null; icon: IconName | null } {
  if (block.isStarred) return { color: "#d98c00", label: "重要", icon: "star" };
  if (block.isQuestion) return { color: "#7c4dff", label: "質問", icon: "help-circle" };
  if (block.isTodo) return { color: "#1f9254", label: "ToDo", icon: "checkmark-circle" };
  return { color: "#8e8e93", label: null, icon: null };
}

type IconBadge = { key: string; icon: IconName; color: string };

// ★・📝・❓が同じブロックに複数付いている場合、色を1色に混ぜて代表させるのではなく、
// 該当するアイコンをすべて横に並べたバッジとして返す
function activeBadges(block: Block): IconBadge[] {
  const badges: IconBadge[] = [];
  if (block.isStarred) badges.push({ key: "star", icon: "star", color: "#d98c00" });
  if (block.isTodo) badges.push({ key: "todo", icon: "checkmark-circle", color: "#1f9254" });
  if (block.isQuestion) badges.push({ key: "question", icon: "help-circle", color: "#7c4dff" });
  return badges;
}

export default function NoteDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "NoteDetail">>();
  const sessionId = route.params.noteId;
  const jumpToBlockId = route.params.jumpToBlockId;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  // このノート(セッション)のセクション区切り閾値。sessions.section_gap_msと連動し、
  // スライダー操作中はDB保存を待たずに即座にここを更新してタイムラインへ反映する
  const [sectionGapMs, setSectionGapMs] = useState(SECTION_GAP_FALLBACK_MS);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // タップ(またはtaps後の自動進行)で「今ハイライトすべきブロック」を直接保持する。
  // 再生位置(leadで手前にずれた実際のシーク位置)から逆算すると、タップした行の
  // 1つ前がハイライトされてしまうため、位置からの逆算はドラッグ中のみに限定する
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  // タイムライン上でテキストをタップして編集中のブロック(発言・メモ・写真キャプション共通)
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // 長押しで開く「結合/分割/マーク」メニューの対象ブロックと、その画面上の位置
  // (ブロックの近くにメニューを吹き出し表示するため、テキスト部分の実測座標を保持する)
  const [menuAnchor, setMenuAnchor] = useState<{
    blockId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  // 分割位置を選んでいる最中のブロックと、選択中のカーソル位置(文字インデックス)
  const [splittingBlockId, setSplittingBlockId] = useState<string | null>(null);
  const [splitIndex, setSplitIndex] = useState(0);
  // 「質問にする」で単語を入力してもらうためのプロンプト(対象ブロックID)
  const [questionPromptBlockId, setQuestionPromptBlockId] = useState<string | null>(null);
  const [questionPromptDraft, setQuestionPromptDraft] = useState("");
  // 「メモを追加」で本文を入力してもらうためのプロンプト(挿入位置の基準となるブロックID)
  const [memoPromptAfterBlockId, setMemoPromptAfterBlockId] = useState<string | null>(null);
  const [memoPromptDraft, setMemoPromptDraft] = useState("");
  // 写真ブロックをタップして全画面表示中のブロック
  const [viewerBlockId, setViewerBlockId] = useState<string | null>(null);

  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const pendingActionRef = useRef<{ seconds: number; autoplay: boolean } | null>(null);
  const wasPlayingBeforeDragRef = useRef(false);
  const timelineScrollRef = useRef<ScrollView>(null);
  // ブロックの本文行のonLayoutは「直接の親(セクションのView)」基準のyしか返さないため、
  // このMapだけではスクロール先の絶対位置(ScrollView全体基準)を求められない。
  // セクションのView自体のonLayout(sectionLayoutYRef)と合算して初めて絶対位置になる
  const blockLayoutYRef = useRef<Map<string, number>>(new Map());
  const sectionLayoutYRef = useRef<Map<string, number>>(new Map());
  // 長押しメニューの位置決めのため、各ブロックの本文Viewの参照を保持する
  const blockRowRefs = useRef<Map<string, View>>(new Map());
  // 長押しメニューを開いたとき、対象ブロックのハイライトが「グイーン」と一回り
  // 大きくなる演出用のアニメーション値(同じ場所を中心に拡大する)
  const menuHighlightScale = useRef(new Animated.Value(1)).current;
  const jumpedBlockIdRef = useRef<string | null>(null);
  // ブロックをタップして再生開始した直後は、そのブロックは既に画面内に見えている
  // (タップできたのだから)ため、自動追従スクロールで無駄に画面をそのブロックの
  // 位置まで動かさないようにするフラグ。1回分だけ効き、フォロー用useEffectが消費する
  const skipFollowScrollOnceRef = useRef(false);
  // 長押しで自動追従(再生位置への自動スクロール)を一時停止しているか。
  // 「↓ 新着N件」バッジをタップするまで解除しない(タイムラインを自由に見て回れるようにするため)
  const [scrollPaused, setScrollPaused] = useState(false);
  // 一時停止を始めた時点の再生中ブロックのインデックス。バッジの「新着N件」はここからの進み具合
  const pauseBaselineIndexRef = useRef(-1);
  // 折りたたまれているセクション(グループ)のkeyの集合。この画面を離れれば自然にリセットされてよいので、
  // 永続化はせずローカルstateのみで管理する
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<Set<string>>(new Set());
  const toggleSectionCollapsed = (key: string) => {
    setCollapsedSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // このノート固有の設定(区切りの細かさなど、今後も追加予定)を開閉するシート。
  // フィルタチップと同じ列に置く歯車ボタンから開く
  const [noteSettingsVisible, setNoteSettingsVisible] = useState(false);
  // 設定画面の「セクション分けを表示する」トグル。設定画面で切り替えた後、
  // この画面に戻ってきた時に反映されるよう、フォーカスの都度読み直す
  const [sectionGroupingEnabled, setSectionGroupingEnabledState] = useState(getSectionGroupingEnabled);
  useFocusEffect(
    useCallback(() => {
      setSectionGroupingEnabledState(getSectionGroupingEnabled());
    }, [])
  );
  // このノートの設定シートからも切り替えられるようにする(設定画面と同じグローバル値)
  const handleToggleSectionGrouping = (value: boolean) => {
    setSectionGroupingEnabledState(value);
    setSectionGroupingEnabled(value);
  };

  // 他画面(Todo/用語集)からのジャンプ指定があれば、絞り込みを解除して該当ブロックが見えるようにする
  useEffect(() => {
    if (jumpToBlockId) {
      setFilter("all");
      jumpedBlockIdRef.current = null;
    }
  }, [jumpToBlockId]);

  const loadBlocks = useCallback(async () => {
    try {
      const rows = await blocksRepo.listBySessionId(sessionId);
      setBlocks(rows);
    } catch (e) {
      console.warn("[DB] ブロック一覧の取得に失敗しました", e);
    }
  }, [sessionId]);

  const loadSession = useCallback(async () => {
    try {
      const row = await sessionsRepo.getById(sessionId);
      setSession(row);
      if (row) setSectionGapMs(row.sectionGapMs);
    } catch (e) {
      console.warn("[DB] セッションの取得に失敗しました", e);
    }
  }, [sessionId]);

  const loadAudioFiles = useCallback(async () => {
    try {
      const rows = await audioFilesRepo.listBySessionId(sessionId);
      setAudioFiles([...rows].sort((a, b) => a.offsetMs - b.offsetMs));
    } catch (e) {
      console.warn("[DB] 音声ファイル一覧の取得に失敗しました", e);
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      loadBlocks();
      loadSession();
      loadAudioFiles();

      // 録音画面などが残した音声モードのままだと、playsInSilentMode が
      // 既定でfalseになり、マナースイッチがオンのとき無音になってしまうため、
      // 再生用のモードをこの画面で明示的に指定し直す
      setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        interruptionMode: "mixWithOthers",
      }).catch((e) => console.warn("[Audio] 再生用の音声モード設定に失敗しました", e));
    }, [loadBlocks, loadSession, loadAudioFiles])
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        // 画面離脱時、player が既にアンマウントで解放されている場合があるため無視する
        try {
          player.pause();
        } catch {
          // ネイティブ側のオブジェクトが既に解放されている場合は無視する
        }
      };
    }, [player])
  );

  // 音声ファイル一覧を取得したら、まだ何も選択されていなければ先頭のファイルを読み込む
  useEffect(() => {
    if (currentFileId || audioFiles.length === 0) return;
    const first = audioFiles[0];
    setCurrentFileId(first.id);
    player.replace({ uri: first.fileUri });
  }, [audioFiles, currentFileId, player]);

  // ファイル切り替え(replace)後、ロード完了を待ってからシーク・再生を行う
  useEffect(() => {
    if (status.isLoaded && pendingActionRef.current) {
      const { seconds, autoplay } = pendingActionRef.current;
      pendingActionRef.current = null;
      player.seekTo(seconds);
      if (autoplay) player.play();
      else player.pause();
    }
  }, [status.isLoaded, player]);

  useLayoutEffect(() => {
    navigation.setOptions({
      // 独自のヘッダー(戻る/エクスポート/タイトル)を表示するため、標準ヘッダーは隠す。
      // シークバーの横ドラッグと、iOSのエッジスワイプ「戻る」ジェスチャーが
      // 競合してしまうため、この画面ではスワイプでの戻る操作も無効化する
      headerShown: false,
      gestureEnabled: false,
    });
  }, [navigation]);

  const startEditingTitle = () => {
    setTitleDraft(session?.title ?? "");
    setIsEditingTitle(true);
  };

  const commitTitle = useCallback(async () => {
    setIsEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!session || trimmed === session.title) return;
    try {
      await sessionsRepo.updateTitle(sessionId, trimmed);
      loadSession();
    } catch (e) {
      console.warn("[DB] タイトルの更新に失敗しました", e);
    }
  }, [titleDraft, session, sessionId, loadSession]);

  // スライダーのドラッグ中は毎フレームsectionGapMsを直接更新して即座に表示へ反映し(下のuseState経由)、
  // 指を離した時にだけDBへ保存する(ドラッグ中に毎回書き込むと無駄が多いため)
  const handleSectionGapChangeComplete = useCallback(
    (ms: number) => {
      sessionsRepo
        .updateSectionGapMs(sessionId, ms)
        .catch((e) => console.warn("[DB] セクション間隔の保存に失敗しました", e));
    },
    [sessionId]
  );

  // 編集中のブロックがあれば内容を確定させ、DBのtextを更新してis_editedを立てる
  const commitBlockEdit = useCallback(async () => {
    const id = editingBlockId;
    setEditingBlockId(null);
    if (!id) return;
    const block = blocks.find((b) => b.id === id);
    const trimmed = editDraft.trim();
    if (!block || trimmed === (block.text ?? "").trim()) return;
    try {
      await blocksRepo.update(id, trimmed);
      loadBlocks();
    } catch (e) {
      console.warn("[DB] ブロックの更新に失敗しました", e);
    }
  }, [editingBlockId, editDraft, blocks, loadBlocks]);

  // 別のブロックの編集を始める前に、今編集中の内容があれば先に確定させておく
  const startEditingBlock = useCallback(
    async (block: Block) => {
      if (splittingBlockId) return; // 分割位置の選択中はテキスト編集を開始しない
      if (editingBlockId && editingBlockId !== block.id) {
        await commitBlockEdit();
      }
      setEditingBlockId(block.id);
      setEditDraft(block.text ?? "");
    },
    [editingBlockId, splittingBlockId, commitBlockEdit]
  );

  const cancelBlockEdit = () => setEditingBlockId(null);

  // 長押しで「結合/分割/マーク」メニューを開く。編集中・分割選択中は開かない。
  // ブロックの本文Viewの画面上の実測座標を取得し、その近くにメニューを表示する
  const openBlockMenu = (block: Block) => {
    if (editingBlockId || splittingBlockId) return;
    if (!scrollPaused) {
      pauseBaselineIndexRef.current = filtered.findIndex((b) => b.id === activeBlockId);
      setScrollPaused(true);
    }
    const node = blockRowRefs.current.get(block.id);
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ blockId: block.id, x, y, width, height });
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

  // 「↓ 新着N件」バッジをタップしたときの再開。自動追従を再開するだけで、実際のスクロールは
  // activeBlockId/scrollPausedを見ているuseEffect(下記)がまとめて行う
  const resumeAutoFollow = () => setScrollPaused(false);

  const openPhotoViewer = (block: Block) => setViewerBlockId(block.id);
  const closePhotoViewer = () => setViewerBlockId(null);

  const startSplitting = (block: Block) => {
    setMenuAnchor(null);
    setSplittingBlockId(block.id);
    setSplitIndex(Math.floor((block.text ?? "").length / 2));
  };

  const cancelSplitting = () => setSplittingBlockId(null);

  // 選んだカーソル位置(文字インデックス)でブロックのテキストを前半/後半に分割する。
  // 後半の開始時刻は、次のブロックとの間の秒数を文字数の比率で按分して見積もる
  // (次のブロックがなければ順序を保つためだけに1msずらす)
  const confirmSplit = useCallback(async () => {
    const id = splittingBlockId;
    setSplittingBlockId(null);
    if (!id) return;
    const block = blocks.find((b) => b.id === id);
    if (!block || !block.text) return;

    const idx = Math.max(1, Math.min(splitIndex, block.text.length - 1));
    const leftText = block.text.slice(0, idx).trim();
    const rightText = block.text.slice(idx).trim();
    if (!leftText || !rightText) return;

    const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
    const nextBlock = sorted.find((b) => b.startMs > block.startMs);
    const ratio = idx / block.text.length;
    const rightStartMs = nextBlock
      ? Math.round(block.startMs + ratio * (nextBlock.startMs - block.startMs))
      : block.startMs + 1;

    try {
      await blocksRepo.splitBlock(id, leftText, {
        id: genId(),
        sessionId,
        kind: block.kind,
        startMs: rightStartMs,
        text: rightText,
      });
      loadBlocks();
    } catch (e) {
      console.warn("[DB] ブロックの分割に失敗しました", e);
    }
  }, [splittingBlockId, splitIndex, blocks, sessionId, loadBlocks]);

  // 前後どちらかの隣接ブロックとテキストを結合する。★/ToDo/質問フラグはORで両方引き継ぐ
  const mergeWithNeighbor = useCallback(
    async (block: Block, direction: "prev" | "next") => {
      setMenuAnchor(null);
      const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
      const index = sorted.findIndex((b) => b.id === block.id);
      const neighbor = direction === "prev" ? sorted[index - 1] : sorted[index + 1];
      if (!neighbor || neighbor.kind === "photo" || block.kind === "photo") return;

      const [earlier, later] =
        neighbor.startMs < block.startMs ? [neighbor, block] : [block, neighbor];
      const mergedText = `${earlier.text ?? ""} ${later.text ?? ""}`.trim();

      try {
        await blocksRepo.mergeBlocks(earlier.id, later.id, mergedText, {
          isStarred: earlier.isStarred || later.isStarred,
          isTodo: earlier.isTodo || later.isTodo,
          todoDone: earlier.todoDone || later.todoDone,
          isQuestion: earlier.isQuestion || later.isQuestion,
          questionTerm: earlier.questionTerm ?? later.questionTerm ?? null,
          questionKind: earlier.questionKind ?? later.questionKind ?? null,
          endMs: later.endMs,
        });
        loadBlocks();
      } catch (e) {
        console.warn("[DB] ブロックの結合に失敗しました", e);
      }
    },
    [blocks, loadBlocks]
  );

  // 指定ブロックの直後・次のブロックとの間の秒数(次が無ければ+1ms)を新規ブロックの挿入位置とする
  const startMsAfter = useCallback(
    (block: Block): number => {
      const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
      const next = sorted.find((b) => b.startMs > block.startMs);
      return next ? Math.round((block.startMs + next.startMs) / 2) : block.startMs + 1;
    },
    [blocks]
  );

  const toggleBlockStar = useCallback(
    async (block: Block) => {
      setMenuAnchor(null);
      try {
        await blocksRepo.toggleStar(block.id);
        loadBlocks();
      } catch (e) {
        console.warn("[DB] ★の切り替えに失敗しました", e);
      }
    },
    [loadBlocks]
  );

  const toggleBlockTodo = useCallback(
    async (block: Block) => {
      setMenuAnchor(null);
      try {
        await blocksRepo.toggleTodo(block.id);
        loadBlocks();
      } catch (e) {
        console.warn("[DB] ToDoの切り替えに失敗しました", e);
      }
    },
    [loadBlocks]
  );

  const toggleBlockTodoDone = useCallback(
    async (block: Block) => {
      setMenuAnchor(null);
      try {
        await blocksRepo.toggleTodoDone(block.id);
        loadBlocks();
      } catch (e) {
        console.warn("[DB] ToDo完了状態の切り替えに失敗しました", e);
      }
    },
    [loadBlocks]
  );

  const copyBlockText = useCallback((block: Block) => {
    setMenuAnchor(null);
    Clipboard.setStringAsync(block.text ?? "").catch((e) =>
      console.warn("[Clipboard] コピーに失敗しました", e)
    );
  }, []);

  const startQuestionPrompt = (block: Block) => {
    setMenuAnchor(null);
    setQuestionPromptBlockId(block.id);
    setQuestionPromptDraft("");
  };

  const cancelQuestionPrompt = () => {
    setQuestionPromptBlockId(null);
    setQuestionPromptDraft("");
  };

  const confirmQuestionPrompt = useCallback(async () => {
    const id = questionPromptBlockId;
    const term = questionPromptDraft.trim();
    setQuestionPromptBlockId(null);
    setQuestionPromptDraft("");
    if (!id) return;
    try {
      // このポップアップは「わからなかった単語」を入力させる用語(term)フローのため、
      // question_kindは常に'term'として保存する(質問集ではなく用語集の対象にするため)
      await blocksRepo.setQuestion(id, true, term || null, "term");
      loadBlocks();
    } catch (e) {
      console.warn("[DB] 質問マークの設定に失敗しました", e);
    }
  }, [questionPromptBlockId, questionPromptDraft, loadBlocks]);

  const clearBlockQuestion = useCallback(
    async (block: Block) => {
      setMenuAnchor(null);
      try {
        await blocksRepo.setQuestion(block.id, false, null, null);
        loadBlocks();
      } catch (e) {
        console.warn("[DB] 質問マークの解除に失敗しました", e);
      }
    },
    [loadBlocks]
  );

  const startMemoPrompt = (block: Block) => {
    setMenuAnchor(null);
    setMemoPromptAfterBlockId(block.id);
    setMemoPromptDraft("");
  };

  const cancelMemoPrompt = () => {
    setMemoPromptAfterBlockId(null);
    setMemoPromptDraft("");
  };

  const confirmMemoPrompt = useCallback(async () => {
    const afterId = memoPromptAfterBlockId;
    const text = memoPromptDraft.trim();
    setMemoPromptAfterBlockId(null);
    setMemoPromptDraft("");
    if (!afterId || !text) return;
    const afterBlock = blocks.find((b) => b.id === afterId);
    if (!afterBlock) return;
    try {
      await blocksRepo.create({
        id: genId(),
        sessionId,
        kind: "note",
        startMs: startMsAfter(afterBlock),
        text,
      });
      loadBlocks();
    } catch (e) {
      console.warn("[DB] メモの追加に失敗しました", e);
    }
  }, [memoPromptAfterBlockId, memoPromptDraft, blocks, sessionId, startMsAfter, loadBlocks]);

  const addPhotoAfter = useCallback(
    async (block: Block) => {
      setMenuAnchor(null);
      try {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (result.canceled || !result.assets?.[0]?.uri) return;

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
          startMs: startMsAfter(block),
          photoUri,
        });
        loadBlocks();
      } catch (e) {
        console.warn("[DB] 写真ブロックの追加に失敗しました", e);
      }
    },
    [sessionId, startMsAfter, loadBlocks]
  );

  // 写真未設定(プレースホルダー表示)のphotoブロックに、タップで写真を撮って添付する
  const attachPhotoToBlock = useCallback(
    async (block: Block) => {
      try {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (result.canceled || !result.assets?.[0]?.uri) return;

        let photoUri = result.assets[0].uri;
        try {
          photoUri = await persistPhotoFile(photoUri, sessionId);
        } catch (copyErr) {
          console.warn("[FS] 写真の永続保存に失敗しました。cacheのURIのまま記録します", copyErr);
        }

        await blocksRepo.setPhotoUri(block.id, photoUri);
        loadBlocks();
      } catch (e) {
        console.warn("[DB] 写真の添付に失敗しました", e);
      }
    },
    [sessionId, loadBlocks]
  );

  const confirmDeleteBlock = useCallback(
    (block: Block) => {
      setMenuAnchor(null);
      Alert.alert("このブロックを削除しますか？", "元に戻せません。", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: async () => {
            try {
              await blocksRepo.remove(block.id);
              if (block.kind === "photo" && block.photoUri) {
                deleteStoredFile(block.photoUri);
              }
              loadBlocks();
            } catch (e) {
              console.warn("[DB] ブロックの削除に失敗しました", e);
            }
          },
        },
      ]);
    },
    [loadBlocks]
  );

  // targetMs(セッション全体での時刻)へ、必要なら音声ファイルを切り替えつつ移動する
  const seekToPosition = useCallback(
    (targetMs: number, applyLead: boolean, autoplay: boolean) => {
      const resolved = resolveAudioPosition(targetMs, audioFiles);
      if (!resolved) return;
      const { file, positionMs } = resolved;
      const leadMs = applyLead ? LEAD_SEC * 1000 : 0;
      const seekSeconds = Math.max(0, positionMs - leadMs) / 1000;

      if (file.id !== currentFileId) {
        setCurrentFileId(file.id);
        pendingActionRef.current = { seconds: seekSeconds, autoplay };
        player.replace({ uri: file.fileUri });
      } else {
        player.seekTo(seekSeconds);
        if (autoplay) player.play();
        else player.pause();
      }
    },
    [audioFiles, currentFileId, player]
  );

  const handleBlockPress = (block: Block) => {
    // 編集中/分割位置選択中のブロック自身の行タップは、テキスト入力やボタンへの
    // タッチと競合しないよう、再生シークを行わない
    if (block.id === editingBlockId || block.id === splittingBlockId) return;
    if (editingBlockId) {
      commitBlockEdit();
    }
    // タップした行は画面内に見えているはずなので、この変更では追従スクロールしない
    skipFollowScrollOnceRef.current = true;
    setHighlightedBlockId(block.id);
    seekToPosition(block.startMs, true, true);
  };

  // シークバーの全長は「実際に録音された音声の合計長」を使う(session.durationMsは
  // 壁時計基準のセッション長で、再起動の空白時間を含むため offsetMs と単位が合わない)
  const totalDurationMs =
    audioFiles.length > 0
      ? Math.max(...audioFiles.map((f) => f.offsetMs + f.durationMs))
      : session?.durationMs ?? 0;
  const currentFile = audioFiles.find((f) => f.id === currentFileId) ?? null;
  const currentGlobalMs = currentFile ? currentFile.offsetMs + status.currentTime * 1000 : 0;
  const displayRatio =
    dragRatio ?? (totalDurationMs > 0 ? Math.min(1, currentGlobalMs / totalDurationMs) : 0);
  const displayMs = dragRatio !== null ? dragRatio * totalDurationMs : currentGlobalMs;

  // ドラッグ終了後、実際の再生位置がシーク先に追いつくまでは離した位置を表示し続ける。
  // シーク直後に一旦 dragRatio を消すと、シークがまだ反映されていない古い再生位置が
  // 一瞬見えてしまう(離した瞬間に元の位置へ戻ったように見える)ため
  useEffect(() => {
    if (dragRatio === null || totalDurationMs <= 0) return;
    const liveRatio = Math.min(1, currentGlobalMs / totalDurationMs);
    const diffMs = Math.abs(liveRatio - dragRatio) * totalDurationMs;
    if (diffMs < 400) {
      setDragRatio(null);
    }
  }, [dragRatio, currentGlobalMs, totalDurationMs]);

  // 万一シーク後の再生位置がいつまでも追いつかない場合の保険(表示が固まらないようにする)
  useEffect(() => {
    if (dragRatio === null) return;
    const timer = setTimeout(() => setDragRatio(null), 1500);
    return () => clearTimeout(timer);
  }, [dragRatio]);

  const sortedBlocks = [...blocks].sort((a, b) => a.startMs - b.startMs);
  // フィルタで絞り込んだ、実際にタイムライン上に表示されているブロック一覧。
  // 自動追従の対象や「新着N件」の件数は、この「今画面に出せるブロック」基準で
  // 数えないと、フィルタで隠れているブロックの位置に飛ぼうとしたり、
  // 表示されないブロックの分まで新着扱いしてしまう
  const filtered = sortedBlocks.filter((b) => matchesFilter(b, filter));

  // 自動再生時: 実際の再生位置(lead分の巻き戻りを含まない currentGlobalMs)が
  // 次のブロックの時刻に到達したら、ハイライトを1つずつ先へ進める。
  // タップ直後(まだleadの手前区間を再生中)は currentGlobalMs がそのブロックの
  // startMs にまだ届いていないため、ここでは前のブロックへ巻き戻さない
  useEffect(() => {
    if (dragRatio !== null) return; // ドラッグ中はリアルタイムのdisplayMsから直接求める(下記)
    setHighlightedBlockId((prev) => {
      const startIndex = sortedBlocks.findIndex((b) => b.id === prev);
      let candidate = prev;
      if (startIndex === -1) {
        for (const b of sortedBlocks) {
          if (b.startMs <= currentGlobalMs) candidate = b.id;
          else break;
        }
      } else {
        for (let i = startIndex + 1; i < sortedBlocks.length; i++) {
          if (sortedBlocks[i].startMs <= currentGlobalMs) candidate = sortedBlocks[i].id;
          else break;
        }
      }
      return candidate;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGlobalMs, dragRatio]);

  let activeBlockId: string | null = highlightedBlockId;
  if (dragRatio !== null) {
    // ドラッグ中は再生位置(lead無し)から直接求める。タップ時のみの問題のため、
    // ドラッグ中の追従(スクラブ)は従来通りリアルタイムに計算してよい
    activeBlockId = null;
    for (const block of sortedBlocks) {
      if (block.startMs <= displayMs) {
        activeBlockId = block.id;
      } else {
        break;
      }
    }
  }

  // 一時停止中、再生位置がバッジを表示した時点からどれだけ進んだか(「新着N件」の件数)。
  // フィルタで非表示のブロックは数えない(表示中のリストを基準にした進み具合のため)
  const activeBlockVisibleIndex = activeBlockId ? filtered.findIndex((b) => b.id === activeBlockId) : -1;
  const newArrivalCount =
    scrollPaused && activeBlockVisibleIndex >= 0 && pauseBaselineIndexRef.current >= 0
      ? Math.max(0, activeBlockVisibleIndex - pauseBaselineIndexRef.current)
      : 0;

  // 再生位置(activeBlockId)の進行にタイムラインを自動追従させる。長押しメニューで
  // 一時停止中(scrollPaused)は、裏側でactiveBlockIdが進んでいてもスクロールしない。
  // また、フィルタで今は表示されていないブロックの場合は、blockLayoutYRefに残っている
  // 古い(フィルタ変更前の)Y座標を使って誤った位置へスクロールしてしまうため、
  // 現在表示中のリスト(filtered)に実際に含まれている場合のみスクロールする
  useEffect(() => {
    // タップ直後の1回だけはスキップする(タップした行=既に見えている行なので動かす必要がない)
    if (skipFollowScrollOnceRef.current) {
      skipFollowScrollOnceRef.current = false;
      return;
    }
    // シークバーをドラッグ中は、指の操作に集中させるためタイムライン側は動かさない
    if (dragRatio !== null) return;
    if (scrollPaused || !activeBlockId) return;
    if (!filtered.some((b) => b.id === activeBlockId)) return;
    // ブロック行のonLayoutは直接の親(セクションのView)基準のyしか返さないため、
    // セクション自体のonLayoutで得た絶対位置(sectionLayoutYRef)と合算する。
    // これをしないと、2番目以降のセクションのブロックへ移動した際、セクション内での
    // 相対的な(小さな)y値がそのままScrollViewの絶対位置として使われてしまい、
    // 画面が一番上近くまで飛んでしまう
    const sectionKey = findSectionKeyForBlock(timelineGroups, activeBlockId);
    const sectionY = sectionKey ? sectionLayoutYRef.current.get(sectionKey) : undefined;
    const rowY = blockLayoutYRef.current.get(activeBlockId);
    if (sectionY === undefined || rowY === undefined) return;
    timelineScrollRef.current?.scrollTo({ y: Math.max(0, sectionY + rowY - 12), animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlockId, scrollPaused, filter, dragRatio]);

  // PanResponder は useRef で一度だけ作られるため、内部のコールバックが
  // 生成時点の値を掴んだままにならないよう、参照する値は ref 経由で常に最新化する
  const trackWidthRef = useRef(trackWidth);
  trackWidthRef.current = trackWidth;
  const totalDurationMsRef = useRef(totalDurationMs);
  totalDurationMsRef.current = totalDurationMs;
  const statusPlayingRef = useRef(status.playing);
  statusPlayingRef.current = status.playing;
  const seekToPositionRef = useRef(seekToPosition);
  seekToPositionRef.current = seekToPosition;

  // locationX は「指の真下にある一番深いビュー」基準で計算されるため、
  // つまみ(絶対配置の小さいView)の上を触ると誤った値になる。
  // そのため画面座標系で常に安定している pageX と、トラックの画面上のX座標(measureで取得)から比率を求める
  const trackRef = useRef<View>(null);
  const trackPageXRef = useRef(0);

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
      trackPageXRef.current = pageX;
    });
  };

  const ratioFromPageX = (pageX: number): number => {
    if (trackWidthRef.current <= 0) return 0;
    return Math.min(1, Math.max(0, (pageX - trackPageXRef.current) / trackWidthRef.current));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // 一度掴んだドラッグ操作を、途中で他のジェスチャー(ScrollView等)に
      // 奪われないようにする。奪われると dragRatio が null に戻り、
      // 再生中の実位置へ一瞬戻ったように見えてしまう
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        wasPlayingBeforeDragRef.current = statusPlayingRef.current;
        setDragRatio(ratioFromPageX(evt.nativeEvent.pageX));
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        setDragRatio(ratioFromPageX(evt.nativeEvent.pageX));
      },
      onPanResponderRelease: (evt: GestureResponderEvent) => {
        const ratio = ratioFromPageX(evt.nativeEvent.pageX);
        // ここでは dragRatio を null に戻さない。実際の再生位置がシーク先に
        // 追いつくまで、離した位置をそのまま表示し続ける(上の useEffect が引き継ぐ)
        setDragRatio(ratio);
        if (totalDurationMsRef.current > 0) {
          seekToPositionRef.current(ratio * totalDurationMsRef.current, false, wasPlayingBeforeDragRef.current);
        }
      },
      onPanResponderTerminate: () => {
        setDragRatio(null);
      },
    })
  ).current;

  const togglePlayPause = () => {
    if (status.playing) {
      player.pause();
    } else if (currentFile) {
      player.play();
    } else if (audioFiles.length > 0) {
      seekToPosition(0, false, true);
    }
  };

  // オフの場合はグルーピングの計算自体を行わず、全ブロックを1つの「グループ」として
  // 扱うことで、下の描画ロジックを変えずにフラットな時系列リスト表示にする
  const timelineGroups = sectionGroupingEnabled
    ? groupByGap(filtered, sectionGapMs)
    : [{ key: "flat", blocks: filtered }];

  // 長押しメニューの対象ブロックと、結合/分割それぞれが可能かどうか
  const menuBlockId = menuAnchor?.blockId ?? null;
  const menuBlock = menuBlockId ? blocks.find((b) => b.id === menuBlockId) ?? null : null;
  const menuBlockMeta = menuBlock ? kindMeta(menuBlock) : null;
  const viewerBlock = viewerBlockId ? blocks.find((b) => b.id === viewerBlockId) ?? null : null;
  const menuBlockIndex = menuBlock ? sortedBlocks.findIndex((b) => b.id === menuBlock.id) : -1;
  const menuPrevBlock = menuBlockIndex > 0 ? sortedBlocks[menuBlockIndex - 1] : null;
  const menuNextBlock =
    menuBlockIndex >= 0 && menuBlockIndex < sortedBlocks.length - 1
      ? sortedBlocks[menuBlockIndex + 1]
      : null;
  const canMergePrev =
    !!menuBlock && menuBlock.kind !== "photo" && !!menuPrevBlock && menuPrevBlock.kind !== "photo";
  const canMergeNext =
    !!menuBlock && menuBlock.kind !== "photo" && !!menuNextBlock && menuNextBlock.kind !== "photo";
  const canSplit = !!menuBlock && menuBlock.kind !== "photo" && (menuBlock.text ?? "").trim().length >= 2;

  // iOSのネイティブな長押しコンテキストメニューに寄せた見た目にするため、
  // 項目を「属性(横並び3つ)」「結合(横並び2つ)」「その他(縦積み)」に分けて組み立ててから
  // 全体の高さを計算し、上下どちらに表示するかを決める
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
          active: menuBlock.isStarred,
          activeColor: "#d98c00",
          inactiveBg: "#fdf0dc",
          onPress: () => toggleBlockStar(menuBlock),
        },
        {
          key: "todo",
          icon: "checkmark",
          active: menuBlock.isTodo,
          activeColor: "#1f9254",
          inactiveBg: "#e0f7e6",
          onPress: () => toggleBlockTodo(menuBlock),
        },
        {
          key: "question",
          icon: "help-circle",
          active: menuBlock.isQuestion,
          activeColor: "#7c4dff",
          inactiveBg: "#f2e8fc",
          onPress: () =>
            menuBlock.isQuestion ? clearBlockQuestion(menuBlock) : startQuestionPrompt(menuBlock),
        },
      ]
    : [];

  const todoDoneItem: MenuItem | null =
    menuBlock && menuBlock.isTodo
      ? {
          key: "todoDone",
          label: menuBlock.todoDone ? "未完了に戻す" : "完了にする",
          icon: "checkmark-done-outline",
          color: "#1f9254",
          onPress: () => toggleBlockTodoDone(menuBlock),
        }
      : null;

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
          key: "copy",
          label: "コピー",
          icon: "copy-outline",
          color: "#8e8e93",
          onPress: () => copyBlockText(menuBlock),
        },
        {
          key: "memo",
          label: "メモを追加",
          icon: "document-text-outline",
          color: "#8e8e93",
          onPress: () => startMemoPrompt(menuBlock),
        },
        {
          key: "photo",
          label: "写真を追加",
          icon: "camera-outline",
          color: "#8e8e93",
          onPress: () => addPhotoAfter(menuBlock),
        },
      ]
    : [];

  const mergeButtons: MenuItem[] = menuBlock
    ? ([
        canMergePrev && {
          key: "mergePrev",
          label: "前と結合",
          icon: "arrow-up" as IconName,
          color: "#8e8e93",
          onPress: () => mergeWithNeighbor(menuBlock, "prev"),
        },
        canMergeNext && {
          key: "mergeNext",
          label: "次と結合",
          icon: "arrow-down" as IconName,
          color: "#8e8e93",
          onPress: () => mergeWithNeighbor(menuBlock, "next"),
        },
      ].filter(Boolean) as MenuItem[])
    : [];

  const splitItem: MenuItem | null =
    menuBlock && canSplit
      ? {
          key: "split",
          label: "分割",
          icon: "swap-horizontal",
          color: "#8e8e93",
          onPress: () => startSplitting(menuBlock),
        }
      : null;

  const deleteItem: MenuItem | null = menuBlock
    ? {
        key: "delete",
        label: "削除",
        icon: "trash-outline",
        color: "#ff3b30",
        onPress: () => confirmDeleteBlock(menuBlock),
      }
    : null;

  // Modalの暗いオーバーレイは画面全体の上に重なるため、対象ブロックの実際の背景色を
  // 変えるだけでは暗幕越しに見えてしまいハイライトに見えない。そこで、実測した位置・
  // サイズぴったりに「明るい複製」をオーバーレイの上に重ねて表示し、ブロック自体が
  // 浮き上がって見えるようにする(プレビュー用に余分な余白は足さない)
  const MENU_ROW_HEIGHT = 44;
  const MENU_ATTR_ROW_HEIGHT = 48;
  const MENU_GAP = 10;
  const MENU_WIDTH = 230;
  const MENU_SCREEN_MARGIN = 40; // ステータスバー/ホームインジケータに被らないための余白
  let menuListTop = 0;
  let menuLeft = 0;
  if (menuAnchor) {
    const windowHeight = Dimensions.get("window").height;
    const windowWidth = Dimensions.get("window").width;
    const menuHeight =
      (menuBlock ? MENU_ATTR_ROW_HEIGHT : 0) +
      (todoDoneItem ? MENU_ROW_HEIGHT : 0) +
      actionItems.length * MENU_ROW_HEIGHT +
      (mergeButtons.length > 0 ? MENU_ROW_HEIGHT : 0) +
      (splitItem ? MENU_ROW_HEIGHT : 0) +
      (deleteItem ? MENU_ROW_HEIGHT : 0);
    // 項目数によってメニューの高さが変わるため、上下どちらに実際に収まる余白が
    // あるかで表示方向を決め、それでも収まりきらない場合は画面内に収まるよう位置を補正する
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#06c" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.topBarButton}
          onPress={() => navigation.navigate("Report", { noteId: sessionId })}
        >
          <Ionicons name="download-outline" size={22} color="#06c" />
        </TouchableOpacity>
      </View>

      <View style={styles.titleSection}>
        {isEditingTitle ? (
          <TextInput
            style={styles.titleInput}
            value={titleDraft}
            onChangeText={setTitleDraft}
            autoFocus
            onBlur={commitTitle}
            onSubmitEditing={commitTitle}
            returnKeyType="done"
          />
        ) : (
          <TouchableOpacity style={styles.titleRow} activeOpacity={0.6} onPress={startEditingTitle}>
            <Text style={styles.titleText} numberOfLines={1}>
              {session ? session.title || defaultTitle(session) : ""}
            </Text>
            <Ionicons name="create-outline" size={16} color="#c7c7cc" />
          </TouchableOpacity>
        )}
        {session ? (
          <Text style={styles.titleMeta}>
            {formatHHMM(session.startedAt)} 開始 ・ {formatMinutes(totalDurationMs || session.durationMs)}
          </Text>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={styles.editKeyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View style={styles.chipRow}>
        {FILTERS.map((f) => {
          const isSelected = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.chip,
                f.bg && !isSelected && { backgroundColor: f.bg },
                f.tint && isSelected && { backgroundColor: f.tint },
                !f.tint && isSelected && styles.chipSelected,
              ]}
              onPress={() => setFilter(f.key)}
            >
              {f.icon ? (
                <Ionicons name={f.icon} size={16} color={isSelected ? "#fff" : f.tint ?? "#3c3c43"} />
              ) : (
                <Text
                  style={[
                    styles.chipText,
                    f.tint && !isSelected && { color: f.tint },
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {f.label}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={styles.chip}
          onPress={() => setNoteSettingsVisible(true)}
        >
          <Ionicons name="options-outline" size={16} color="#3c3c43" />
        </TouchableOpacity>
      </View>

      <View style={styles.timelineWrap}>
      {scrollPaused && newArrivalCount > 0 ? (
        <View style={styles.followBadgeContainer} pointerEvents="box-none">
          <TouchableOpacity style={styles.followBadge} activeOpacity={0.85} onPress={resumeAutoFollow}>
            <Ionicons name="arrow-down" size={13} color="#fff" />
            <Text style={styles.followBadgeText}>{`新着 ${newArrivalCount}件`}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <ScrollView ref={timelineScrollRef} style={styles.timeline}>
        {filtered.length === 0 ? (
          <Text style={styles.emptyText}>表示できるブロックがありません</Text>
        ) : (
          timelineGroups.map((group, groupIndex) => {
            const isCollapsed = collapsedSectionKeys.has(group.key);
            return (
            <View
              key={group.key}
              style={styles.sectionWrap}
              onLayout={(e) => sectionLayoutYRef.current.set(group.key, e.nativeEvent.layout.y)}
            >
              {sectionGroupingEnabled && groupIndex > 0 ? <View style={styles.sectionDivider} /> : null}
              {sectionGroupingEnabled ? (
                <TouchableOpacity
                  style={styles.sectionHeaderRow}
                  activeOpacity={0.6}
                  onPress={() => toggleSectionCollapsed(group.key)}
                >
                  <Text style={styles.sectionHeader}>
                    {isCollapsed ? "▶" : "▼"} セクション{groupIndex + 1} ({formatSectionRange(group.blocks, session)})
                  </Text>
                </TouchableOpacity>
              ) : null}
              {isCollapsed
                ? null
                : group.blocks.map((block, blockIndex) => {
                const meta = kindMeta(block);
                const badges = activeBadges(block);
                // ブロック同士を縦線でつなぐ。この線は同じセクション(グループ)内でのみ
                // つながり、セクションの先頭/末尾では途切れる。将来、発言間の秒数に応じて
                // セクション(グループ)をさらに細かく分ける予定のため、線の有無は
                // 常にこのグループ境界(groupByGapの結果)に追従させる
                const hasLineBelow = blockIndex < group.blocks.length - 1;
                // 「間」が短いほど、同じ段落として行間を詰めて自然に繋げて見せる
                // (セクション分けをオフにしている時は、フラットな時系列リストにするため計算しない)
                const spacing = sectionGroupingEnabled
                  ? rowSpacingFor(group.blocks[blockIndex - 1], block)
                  : "line";
                return (
                  <Fragment key={block.id}>
                  <TouchableOpacity
                    style={[
                      styles.timelineRow,
                      spacing === "paragraph" && styles.timelineRowParagraph,
                      block.id === activeBlockId && styles.timelineRowActive,
                      block.id === jumpToBlockId && styles.timelineRowJumped,
                      block.id === editingBlockId && styles.timelineRowEditing,
                      block.id === splittingBlockId && styles.timelineRowEditing,
                      block.id === menuBlockId && styles.timelineRowMenuTarget,
                    ]}
                    activeOpacity={0.6}
                    onPress={() => handleBlockPress(block)}
                    onLongPress={() => openBlockMenu(block)}
                    ref={(node) => {
                      if (node) blockRowRefs.current.set(block.id, node);
                      else blockRowRefs.current.delete(block.id);
                    }}
                    onLayout={(e) => {
                      blockLayoutYRef.current.set(block.id, e.nativeEvent.layout.y);
                      if (
                        jumpToBlockId === block.id &&
                        jumpedBlockIdRef.current !== block.id
                      ) {
                        jumpedBlockIdRef.current = block.id;
                        const sectionY = sectionLayoutYRef.current.get(group.key) ?? 0;
                        timelineScrollRef.current?.scrollTo({
                          y: Math.max(0, sectionY + e.nativeEvent.layout.y - 12),
                          animated: true,
                        });
                      }
                    }}
                  >
                    <View style={styles.timelineDotCol}>
                      <View style={styles.timelineDotWrap}>
                        <View style={[styles.timelineDot, { backgroundColor: meta.color }]} />
                      </View>
                      {hasLineBelow ? <View style={styles.timelineConnector} /> : null}
                    </View>
                    <View style={styles.timelineBody}>
                      <View style={styles.timelineMetaRow}>
                        <Text style={styles.timelineTime}>
                          {fmt(block.startMs)}
                          {session ? (
                            <Text style={styles.timelineTimeWallClock}>
                              {` ・ ${formatHHMM(session.startedAt + block.startMs)}`}
                            </Text>
                          ) : null}
                        </Text>
                        {badges.length > 0 ? (
                          <View style={styles.timelineBadgeRow}>
                            {badges.map((b) => (
                              <Ionicons key={b.key} name={b.icon} size={13} color={b.color} />
                            ))}
                          </View>
                        ) : null}
                        {block.isEdited ? (
                          <View style={styles.editedBadge}>
                            <Ionicons name="pencil" size={10} color="#8e8e93" />
                            <Text style={styles.editedBadgeText}>編集済み</Text>
                          </View>
                        ) : null}
                      </View>
                      {block.kind === "photo" ? (
                        block.photoUri ? (
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => openPhotoViewer(block)}
                            onLongPress={() => openBlockMenu(block)}
                          >
                            <Image source={{ uri: block.photoUri }} style={styles.timelinePhoto} />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            activeOpacity={0.7}
                            style={styles.timelinePhotoPlaceholder}
                            onPress={() => attachPhotoToBlock(block)}
                            onLongPress={() => openBlockMenu(block)}
                          >
                            <Text style={styles.timelinePhotoLabel}>タップして写真を撮る</Text>
                          </TouchableOpacity>
                        )
                      ) : null}
                      {splittingBlockId === block.id ? (
                        <View>
                          <Text style={styles.splitHintText}>分割したい位置をタップしてください</Text>
                          <TextInput
                            style={styles.timelineTextInput}
                            value={block.text ?? ""}
                            onChangeText={() => {}}
                            onSelectionChange={(e) => setSplitIndex(e.nativeEvent.selection.start)}
                            showSoftInputOnFocus={false}
                            autoFocus
                            multiline
                          />
                          <View style={styles.editActionsRow}>
                            <TouchableOpacity style={styles.editActionButton} onPress={cancelSplitting}>
                              <Text style={styles.editActionButtonText}>キャンセル</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.editActionButton, styles.editActionButtonPrimary]}
                              onPress={confirmSplit}
                            >
                              <Text style={styles.editActionButtonPrimaryText}>この位置で分割</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : editingBlockId === block.id ? (
                        <View>
                          <TextInput
                            style={styles.timelineTextInput}
                            value={editDraft}
                            onChangeText={setEditDraft}
                            autoFocus
                            multiline
                          />
                          <View style={styles.editActionsRow}>
                            <TouchableOpacity
                              style={styles.editActionButton}
                              onPress={cancelBlockEdit}
                            >
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
                        <TouchableOpacity
                          activeOpacity={0.6}
                          onPress={() =>
                            block.id === activeBlockId
                              ? startEditingBlock(block)
                              : handleBlockPress(block)
                          }
                          onLongPress={() => openBlockMenu(block)}
                        >
                          <Text style={block.text ? styles.timelineText : styles.timelineTextPlaceholder}>
                            {block.text || "タップしてメモを追加"}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {block.isQuestion && block.questionTerm ? (
                        <Text style={styles.questionTermText}>わからなかった単語: {block.questionTerm}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                  </Fragment>
                );
              })}
            </View>
            );
          })
        )}
      </ScrollView>
      </View>

      {audioFiles.length > 0 ? (
        <View style={styles.playerBar}>
          <TouchableOpacity style={styles.playerButton} activeOpacity={0.7} onPress={togglePlayPause}>
            <Ionicons name={status.playing ? "pause" : "play"} size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.playerTime}>{fmt(displayMs)}</Text>
          <View
            ref={trackRef}
            style={styles.playerTrack}
            onLayout={handleTrackLayout}
            {...panResponder.panHandlers}
          >
            <View style={styles.playerTrackBg} />
            <View style={[styles.playerTrackFill, { width: `${displayRatio * 100}%` }]} />
            <View style={[styles.playerThumb, { left: `${displayRatio * 100}%` }]} />
          </View>
          <Text style={styles.playerTime}>{fmt(totalDurationMs)}</Text>
        </View>
      ) : null}
      </KeyboardAvoidingView>

      <Modal visible={menuAnchor !== null} animationType="fade" transparent onRequestClose={closeBlockMenu}>
        <Pressable style={styles.menuOverlay} onPress={closeBlockMenu}>
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
                <View style={styles.timelineDotCol}>
                  <View style={styles.timelineDotWrap}>
                    <View style={[styles.timelineDot, { backgroundColor: menuBlockMeta?.color }]} />
                  </View>
                </View>
                <View style={styles.timelineBody}>
                  <View style={styles.timelineMetaRow}>
                    <Text style={styles.timelineTime}>
                      {fmt(menuBlock.startMs)}
                      {session ? (
                        <Text style={styles.timelineTimeWallClock}>
                          {` ・ ${formatHHMM(session.startedAt + menuBlock.startMs)}`}
                        </Text>
                      ) : null}
                    </Text>
                    {menuBlock ? (
                      (() => {
                        const badges = activeBadges(menuBlock);
                        return badges.length > 0 ? (
                          <View style={styles.timelineBadgeRow}>
                            {badges.map((b) => (
                              <Ionicons key={b.key} name={b.icon} size={13} color={b.color} />
                            ))}
                          </View>
                        ) : null;
                      })()
                    ) : null}
                    {menuBlock.isEdited ? (
                      <View style={styles.editedBadge}>
                        <Ionicons name="pencil" size={10} color="#8e8e93" />
                        <Text style={styles.editedBadgeText}>編集済み</Text>
                      </View>
                    ) : null}
                  </View>
                  {menuBlock.kind === "photo" ? (
                    menuBlock.photoUri ? (
                      <Image source={{ uri: menuBlock.photoUri }} style={styles.timelinePhoto} />
                    ) : (
                      <View style={styles.timelinePhotoPlaceholder}>
                        <Text style={styles.timelinePhotoLabel}>SLIDE</Text>
                      </View>
                    )
                  ) : null}
                  <Text style={styles.timelineText} numberOfLines={4}>
                    {menuBlock.text || "タップしてメモを追加"}
                  </Text>
                  {menuBlock.isQuestion && menuBlock.questionTerm ? (
                    <Text style={styles.questionTermText}>
                      わからなかった単語: {menuBlock.questionTerm}
                    </Text>
                  ) : null}
                </View>
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
                {todoDoneItem ? (
                  <TouchableOpacity
                    style={[styles.menuItem, styles.menuItemDivider]}
                    onPress={todoDoneItem.onPress}
                  >
                    <Text style={styles.menuItemText}>{todoDoneItem.label}</Text>
                    <Ionicons name={todoDoneItem.icon} size={18} color={todoDoneItem.color} />
                  </TouchableOpacity>
                ) : null}
                {actionItems.map((item, index) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.menuItem, (index > 0 || todoDoneItem) && styles.menuItemDivider]}
                    onPress={item.onPress}
                  >
                    <Text style={styles.menuItemText}>{item.label}</Text>
                    <Ionicons name={item.icon} size={18} color={item.color} />
                  </TouchableOpacity>
                ))}
                {mergeButtons.length > 0 ? (
                  <View style={[styles.menuMergeRow, styles.menuItemDivider]}>
                    {mergeButtons.map((item, index) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.menuMergeButton, index > 0 && styles.menuAttrButtonDivider]}
                        onPress={item.onPress}
                      >
                        <Ionicons name={item.icon} size={16} color={item.color} />
                        <Text style={styles.menuMergeButtonText}>{item.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                {splitItem ? (
                  <TouchableOpacity
                    style={[styles.menuItem, mergeButtons.length === 0 && styles.menuItemDivider]}
                    onPress={splitItem.onPress}
                  >
                    <Text style={styles.menuItemText}>{splitItem.label}</Text>
                    <Ionicons name={splitItem.icon} size={18} color={splitItem.color} />
                  </TouchableOpacity>
                ) : null}
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

      <Modal
        visible={questionPromptBlockId !== null}
        animationType="fade"
        transparent
        onRequestClose={cancelQuestionPrompt}
      >
        <KeyboardAvoidingView
          style={styles.promptKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.debugOverlay} onPress={cancelQuestionPrompt}>
            <Pressable style={styles.promptPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.promptTitle}>わからなかった単語</Text>
              <TextInput
                style={styles.promptInput}
                value={questionPromptDraft}
                onChangeText={setQuestionPromptDraft}
                placeholder="例: アブレーション"
                autoFocus
              />
              <View style={styles.promptButtonRow}>
                <TouchableOpacity style={styles.editActionButton} onPress={cancelQuestionPrompt}>
                  <Text style={styles.editActionButtonText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editActionButton, styles.editActionButtonPrimary]}
                  onPress={confirmQuestionPrompt}
                >
                  <Text style={styles.editActionButtonPrimaryText}>保存</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={memoPromptAfterBlockId !== null}
        animationType="fade"
        transparent
        onRequestClose={cancelMemoPrompt}
      >
        <KeyboardAvoidingView
          style={styles.promptKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.debugOverlay} onPress={cancelMemoPrompt}>
            <Pressable style={styles.promptPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.promptTitle}>メモ</Text>
              <TextInput
                style={[styles.promptInput, styles.promptInputMultiline]}
                value={memoPromptDraft}
                onChangeText={setMemoPromptDraft}
                placeholder="メモを入力"
                multiline
                autoFocus
              />
              <View style={styles.promptButtonRow}>
                <TouchableOpacity style={styles.editActionButton} onPress={cancelMemoPrompt}>
                  <Text style={styles.editActionButtonText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editActionButton, styles.editActionButtonPrimary]}
                  onPress={confirmMemoPrompt}
                >
                  <Text style={styles.editActionButtonPrimaryText}>保存</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <PhotoViewerModal
        visible={viewerBlockId !== null}
        photoUri={viewerBlock?.photoUri ?? null}
        caption={viewerBlock?.text ?? null}
        onClose={closePhotoViewer}
      />

      <Modal
        visible={noteSettingsVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setNoteSettingsVisible(false)}
      >
        <Pressable style={styles.debugOverlay} onPress={() => setNoteSettingsVisible(false)}>
          <Pressable style={styles.promptPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.promptTitle}>このノートの設定</Text>
            <View style={styles.noteSettingsRow}>
              <Text style={styles.noteSettingsRowLabel}>セクション分けを表示する</Text>
              <Switch value={sectionGroupingEnabled} onValueChange={handleToggleSectionGrouping} />
            </View>
            {sectionGroupingEnabled ? (
              <SectionGapSlider
                valueMs={sectionGapMs}
                onChange={setSectionGapMs}
                onChangeComplete={handleSectionGapChangeComplete}
              />
            ) : (
              <Text style={styles.noteSettingsDisabledText}>
                セクション分けをオフにしているため、区切りの細かさは調整できません。
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// セクション区切りの閾値(2.0〜8.0秒、0.5秒刻み)を調整するスライダー。
// 再生バーのシークバー(PanResponder方式)と同じ考え方の、専用の独立したトラック
function SectionGapSlider({
  valueMs,
  onChange,
  onChangeComplete,
}: {
  valueMs: number;
  onChange: (ms: number) => void;
  onChangeComplete: (ms: number) => void;
}) {
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);
  // PanResponderはuseRefで一度だけ作られるため、内部から呼ぶコールバックは常に最新のpropsを
  // 参照するようrefを介す(再生バーのシークバーと同じ理由)
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onChangeCompleteRef = useRef(onChangeComplete);
  onChangeCompleteRef.current = onChangeComplete;

  const msFromRatio = (ratio: number): number => {
    const raw = SECTION_GAP_MIN_MS + ratio * (SECTION_GAP_MAX_MS - SECTION_GAP_MIN_MS);
    const stepped = Math.round(raw / SECTION_GAP_STEP_MS) * SECTION_GAP_STEP_MS;
    return Math.min(SECTION_GAP_MAX_MS, Math.max(SECTION_GAP_MIN_MS, stepped));
  };

  const ratioFromPageX = (pageX: number): number => {
    if (trackWidthRef.current <= 0) return 0;
    return Math.min(1, Math.max(0, (pageX - trackPageXRef.current) / trackWidthRef.current));
  };

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    trackWidthRef.current = e.nativeEvent.layout.width;
    trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
      trackPageXRef.current = pageX;
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        onChangeRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        onChangeRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
      },
      onPanResponderRelease: (evt: GestureResponderEvent) => {
        onChangeCompleteRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
      },
      onPanResponderTerminate: (evt: GestureResponderEvent) => {
        onChangeCompleteRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
      },
    })
  ).current;

  const ratio = (valueMs - SECTION_GAP_MIN_MS) / (SECTION_GAP_MAX_MS - SECTION_GAP_MIN_MS);

  return (
    <View style={styles.gapSliderWrap}>
      <Text style={styles.gapSliderLabel}>
        区切りの細かさ: {(valueMs / 1000).toFixed(1)}秒
      </Text>
      <View
        ref={trackRef}
        style={styles.gapSliderTrack}
        onLayout={handleTrackLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.gapSliderTrackBg} />
        <View style={[styles.gapSliderTrackFill, { width: `${ratio * 100}%` }]} />
        <View style={[styles.gapSliderThumb, { left: `${ratio * 100}%` }]} />
      </View>
      <View style={styles.gapSliderEndsRow}>
        <Text style={styles.gapSliderEndText}>細かく分ける</Text>
        <Text style={styles.gapSliderEndText}>まとめる</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  topBarButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },

  titleSection: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  titleText: { fontSize: 22, fontWeight: "700", color: "#1c1c1e", flexShrink: 1 },
  titleInput: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1c1c1e",
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#06c",
  },
  titleMeta: { fontSize: 13, color: "#8e8e93", marginTop: 4 },

  editKeyboardAvoider: { flex: 1 },

  chipRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#ebebf0",
  },
  chipSelected: { backgroundColor: "#1c1c1e" },
  chipText: { fontSize: 13, color: "#3c3c43", fontWeight: "600" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },

  // セクション区切りの細かさスライダー
  gapSliderWrap: {},
  noteSettingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteSettingsRowLabel: { fontSize: 15, color: "#1c1c1e" },
  noteSettingsDisabledText: { fontSize: 13, color: "#8e8e93", lineHeight: 19 },
  gapSliderLabel: { fontSize: 12, color: "#8e8e93", marginBottom: 6 },
  gapSliderTrack: { height: 24, justifyContent: "center" },
  gapSliderTrackBg: { height: 4, borderRadius: 2, backgroundColor: "#e2e2e7" },
  gapSliderTrackFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    backgroundColor: "#06c",
  },
  gapSliderThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#06c",
    marginLeft: -9,
  },
  gapSliderEndsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  gapSliderEndText: { fontSize: 11, color: "#c7c7cc" },

  timelineWrap: { flex: 1 },
  // タイムラインの一番下(プレイヤーバーのすぐ上)に浮かせる。timelineWrap自体が
  // プレイヤーバーの手前で終わるコンテナのため、bottom基準でもプレイヤーバーとは重ならない
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
  timeline: { flex: 1, paddingHorizontal: 16 },
  // セクション(発言間の「間」が5秒以上)の区切り。見出しの上に薄い罫線を入れて、
  // 余白だけでなく視覚的にもセクションの境目とわかるようにする
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
  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: 8,
  },
  // 発言間の「間」が1.5秒未満のブロックは、同じ段落として自然に繋がって見えるよう
  // 行間を詰める(見出しや余白は入れず、現状の行ベースの見た目を保ったまま間隔だけ縮める)
  timelineRowParagraph: { paddingVertical: 1 },
  timelineRowActive: { backgroundColor: "#eaf2ff" },
  timelineRowJumped: { backgroundColor: "#fff4d6" },
  timelineRowEditing: { backgroundColor: "#fffaf0" },
  timelineRowMenuTarget: { backgroundColor: "#e5e5ea" },
  timelineDotCol: { width: 16, alignItems: "center" },
  timelineDotWrap: { paddingTop: 6, paddingBottom: 2 },
  timelineConnector: { flex: 1, width: 2, backgroundColor: "#d1d1d6", marginBottom: -8 },
  timelineDot: { width: 6, height: 6, borderRadius: 3 },
  timelineBody: { flex: 1 },
  timelineMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  timelineTime: { fontSize: 12, fontWeight: "600", color: "#8e8e93" },
  // 収録開始からの経過時間を主表示にし、時刻(壁時計)は補助として小さく添える
  timelineTimeWallClock: { fontSize: 11, fontWeight: "400", color: "#c7c7cc" },
  timelineBadgeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  editedBadge: { flexDirection: "row", alignItems: "center", gap: 2 },
  editedBadgeText: { fontSize: 10, color: "#8e8e93" },
  timelineText: { fontSize: 15, color: "#1c1c1e", lineHeight: 21 },
  timelineTextPlaceholder: { fontSize: 15, color: "#b0b0b6", lineHeight: 21, fontStyle: "italic" },
  timelineTextInput: {
    fontSize: 15,
    color: "#1c1c1e",
    lineHeight: 21,
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
  splitHintText: { fontSize: 12, color: "#8e8e93", marginBottom: 4 },

  // 0.3だと薄すぎてキーボードが透けて見えてしまうため、適切な濃さまで上げる
  debugOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    zIndex: 10,
  },

  // 長押しメニュー(iOSネイティブ風): 暗幕の上に、実測した位置・サイズぴったりの
  // 明るい複製を重ねてハイライトとし、その近くに項目リストを吹き出し表示する
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  menuHighlight: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
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
  menuMergeRow: { flexDirection: "row", height: 44 },
  menuMergeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  menuMergeButtonText: { fontSize: 13, fontWeight: "600", color: "#8e8e93" },

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
  promptTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
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
  timelinePhoto: { width: "100%", height: 180, borderRadius: 8, marginTop: 4, backgroundColor: "#f2f2f7" },
  timelinePhotoPlaceholder: {
    width: "100%",
    height: 140,
    borderRadius: 8,
    marginTop: 4,
    backgroundColor: "#e5e5ea",
    alignItems: "center",
    justifyContent: "center",
  },
  timelinePhotoLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#8e8e93",
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  questionTermText: { fontSize: 12, color: "#7c4dff", marginTop: 4 },
  emptyText: { color: "#8e8e93", fontSize: 14, textAlign: "center", marginTop: 40 },

  playerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5ea",
    backgroundColor: "#fafafc",
  },
  playerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1c1c1e",
    justifyContent: "center",
    alignItems: "center",
  },
  playerTime: { fontSize: 12, color: "#8e8e93", fontVariant: ["tabular-nums"], width: 40 },
  playerTrack: {
    flex: 1,
    height: 24,
    justifyContent: "center",
  },
  playerTrackBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e2e7",
  },
  playerTrackFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    backgroundColor: "#1c1c1e",
  },
  playerThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#1c1c1e",
    marginLeft: -7,
  },
});
