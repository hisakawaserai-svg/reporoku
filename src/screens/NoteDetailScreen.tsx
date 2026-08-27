import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
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

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as blocksRepo from "../db/repositories/blocks";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import * as sessionsRepo from "../db/repositories/sessions";
import type { AudioFile, Block, Session } from "../db/types";
import { resolveAudioPosition } from "../utils/audioTimeline";

type FilterKey = "all" | "star" | "todo" | "question" | "photo";

const FILTERS: { key: FilterKey; label: string; bg?: string; tint?: string }[] = [
  { key: "all", label: "すべて" },
  { key: "star", label: "★", bg: "#fdf0dc", tint: "#d98c00" },
  { key: "todo", label: "✓", bg: "#e0f7e6", tint: "#1f9254" },
  { key: "question", label: "?", bg: "#f2e8fc", tint: "#7c4dff" },
  { key: "photo", label: "📷", bg: "#eef1f4", tint: "#57575c" },
];

const LEAD_SEC = 1.2;
// この間隔(ミリ秒)以上ブロックの開始時刻が離れていたら、タイムライン上に
// 新しいセクション見出しを自動挿入する
const SECTION_GAP_MS = 5000;

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
    default:
      return true;
  }
}

type TimelineGroup = { key: string; blocks: Block[] };

function groupByGap(blocks: Block[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    if (!prev || block.startMs - prev.startMs >= SECTION_GAP_MS) {
      groups.push({ key: block.id, blocks: [block] });
    } else {
      groups[groups.length - 1].blocks.push(block);
    }
  });
  return groups;
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

export default function NoteDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "NoteDetail">>();
  const sessionId = route.params.noteId;
  const jumpToBlockId = route.params.jumpToBlockId;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [session, setSession] = useState<Session | null>(null);
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

  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const pendingActionRef = useRef<{ seconds: number; autoplay: boolean } | null>(null);
  const wasPlayingBeforeDragRef = useRef(false);
  const timelineScrollRef = useRef<ScrollView>(null);
  const blockLayoutYRef = useRef<Map<string, number>>(new Map());
  const jumpedBlockIdRef = useRef<string | null>(null);

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
      if (editingBlockId && editingBlockId !== block.id) {
        await commitBlockEdit();
      }
      setEditingBlockId(block.id);
      setEditDraft(block.text ?? "");
    },
    [editingBlockId, commitBlockEdit]
  );

  const cancelBlockEdit = () => setEditingBlockId(null);

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
    // 編集中のブロック自身の行タップは、テキスト入力や完了/キャンセルボタンへの
    // タッチと競合しないよう、再生シークを行わない
    if (block.id === editingBlockId) return;
    if (editingBlockId) {
      commitBlockEdit();
    }
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

  const filtered = sortedBlocks.filter((b) => matchesFilter(b, filter));
  const timelineGroups = groupByGap(filtered);

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
              <Text
                style={[
                  styles.chipText,
                  f.tint && !isSelected && { color: f.tint },
                  isSelected && styles.chipTextSelected,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView ref={timelineScrollRef} style={styles.timeline}>
        {filtered.length === 0 ? (
          <Text style={styles.emptyText}>表示できるブロックがありません</Text>
        ) : (
          timelineGroups.map((group) => (
            <View key={group.key}>
              <Text style={styles.sectionHeader}>{formatSectionRange(group.blocks, session)}</Text>
              {group.blocks.map((block, blockIndex) => {
                const meta = kindMeta(block);
                // ブロック同士を縦線でつなぐ。この線は同じセクション(グループ)内でのみ
                // つながり、セクションの先頭/末尾では途切れる。将来、発言間の秒数に応じて
                // セクション(グループ)をさらに細かく分ける予定のため、線の有無は
                // 常にこのグループ境界(groupByGapの結果)に追従させる
                const hasLineBelow = blockIndex < group.blocks.length - 1;
                return (
                  <TouchableOpacity
                    key={block.id}
                    style={[
                      styles.timelineRow,
                      block.id === activeBlockId && styles.timelineRowActive,
                      block.id === jumpToBlockId && styles.timelineRowJumped,
                      block.id === editingBlockId && styles.timelineRowEditing,
                    ]}
                    activeOpacity={0.6}
                    onPress={() => handleBlockPress(block)}
                    onLayout={(e) => {
                      blockLayoutYRef.current.set(block.id, e.nativeEvent.layout.y);
                      if (
                        jumpToBlockId === block.id &&
                        jumpedBlockIdRef.current !== block.id
                      ) {
                        jumpedBlockIdRef.current = block.id;
                        timelineScrollRef.current?.scrollTo({
                          y: Math.max(0, e.nativeEvent.layout.y - 12),
                          animated: true,
                        });
                      }
                    }}
                  >
                    <View style={styles.timelineDotCol}>
                      <View style={styles.timelineDotWrap}>
                        {meta.icon ? (
                          <Ionicons name={meta.icon} size={14} color={meta.color} />
                        ) : (
                          <View style={[styles.timelineDot, { backgroundColor: meta.color }]} />
                        )}
                      </View>
                      {hasLineBelow ? <View style={styles.timelineConnector} /> : null}
                    </View>
                    <View style={styles.timelineBody}>
                      <View style={styles.timelineMetaRow}>
                        <Text style={[styles.timelineTime, { color: meta.color }]}>
                          {session ? formatHHMM(session.startedAt + block.startMs) : fmt(block.startMs)}
                          {meta.label ? ` ・ ${meta.label}` : ""}
                        </Text>
                        {block.isEdited ? (
                          <View style={styles.editedBadge}>
                            <Ionicons name="pencil" size={10} color="#8e8e93" />
                            <Text style={styles.editedBadgeText}>編集済み</Text>
                          </View>
                        ) : null}
                      </View>
                      {block.kind === "photo" ? (
                        block.photoUri ? (
                          <Image source={{ uri: block.photoUri }} style={styles.timelinePhoto} />
                        ) : (
                          <View style={styles.timelinePhotoPlaceholder}>
                            <Text style={styles.timelinePhotoLabel}>SLIDE</Text>
                          </View>
                        )
                      ) : null}
                      {editingBlockId === block.id ? (
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
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

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
    </SafeAreaView>
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

  timeline: { flex: 1, paddingHorizontal: 16 },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginTop: 14,
    marginBottom: 6,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: 8,
  },
  timelineRowActive: { backgroundColor: "#eaf2ff" },
  timelineRowJumped: { backgroundColor: "#fff4d6" },
  timelineRowEditing: { backgroundColor: "#fffaf0" },
  timelineDotCol: { width: 16, alignItems: "center" },
  timelineDotWrap: { paddingTop: 6, paddingBottom: 2 },
  timelineConnector: { flex: 1, width: 2, backgroundColor: "#d1d1d6", marginBottom: -8 },
  timelineDot: { width: 6, height: 6, borderRadius: 3 },
  timelineBody: { flex: 1 },
  timelineMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  timelineTime: { fontSize: 12, fontWeight: "600" },
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
