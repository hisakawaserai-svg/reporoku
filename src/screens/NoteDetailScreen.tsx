import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  GestureResponderEvent,
  Image,
  LayoutChangeEvent,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
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

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "star", label: "★" },
  { key: "todo", label: "📝" },
  { key: "question", label: "❓" },
  { key: "photo", label: "📷" },
];

const LEAD_SEC = 1.2;

function fmt(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
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
      // シークバーの横ドラッグと、iOSのエッジスワイプ「戻る」ジェスチャーが
      // 競合してしまうため、この画面ではスワイプでの戻る操作を無効化する
      gestureEnabled: false,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate("Report", { noteId: sessionId })}
        >
          <Text style={styles.headerButton}>レポート出力</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, sessionId]);

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
    seekToPosition(block.startMs, true, true);
  };

  const totalDurationMs = session?.durationMs ?? 0;
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
  let activeBlockId: string | null = null;
  for (const block of sortedBlocks) {
    if (block.startMs <= displayMs) {
      activeBlockId = block.id;
    } else {
      break;
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipSelected]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextSelected]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView ref={timelineScrollRef} style={styles.timeline}>
        {filtered.length === 0 ? (
          <Text style={styles.emptyText}>表示できるブロックがありません</Text>
        ) : (
          filtered.map((block) => (
            <TouchableOpacity
              key={block.id}
              style={[
                styles.timelineRow,
                block.id === activeBlockId && styles.timelineRowActive,
                block.id === jumpToBlockId && styles.timelineRowJumped,
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
              <Text style={styles.timelineTime}>[{fmt(block.startMs)}]</Text>
              <View style={styles.timelineBody}>
                <View style={styles.timelineMarksRow}>
                  {block.isStarred ? <Text style={[styles.timelineMark, { color: "#e0a800" }]}>★</Text> : null}
                  {block.isTodo ? <Text style={[styles.timelineMark, { color: "#06c" }]}>📝</Text> : null}
                  {block.isQuestion ? <Text style={[styles.timelineMark, { color: "#7c4dff" }]}>❓</Text> : null}
                  {block.kind === "photo" ? <Text style={[styles.timelineMark, { color: "#555" }]}>📷</Text> : null}
                  {block.kind === "note" ? <Text style={[styles.timelineMark, { color: "#555" }]}>✏️</Text> : null}
                </View>
                {block.kind === "photo" && block.photoUri ? (
                  <Image source={{ uri: block.photoUri }} style={styles.timelinePhoto} />
                ) : (
                  <Text style={styles.timelineText}>{block.text}</Text>
                )}
                {block.isQuestion && block.questionTerm ? (
                  <Text style={styles.questionTermText}>わからなかった単語: {block.questionTerm}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {audioFiles.length > 0 ? (
        <View style={styles.playerBar}>
          <TouchableOpacity style={styles.playerButton} activeOpacity={0.7} onPress={togglePlayPause}>
            <Ionicons name={status.playing ? "pause" : "play"} size={22} color="#1c1c1e" />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  headerButton: { color: "#06c", fontSize: 15, fontWeight: "600" },
  chipRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#ebebf0",
  },
  chipSelected: { backgroundColor: "#06c" },
  chipText: { fontSize: 13, color: "#3c3c43" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  timeline: { flex: 1, paddingHorizontal: 16 },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  timelineRowActive: { backgroundColor: "#eaf2ff" },
  timelineRowJumped: { backgroundColor: "#fff4d6" },
  timelineTime: { fontSize: 12, color: "#8e8e93", marginRight: 8, marginTop: 2 },
  timelineBody: { flex: 1 },
  timelineMarksRow: { flexDirection: "row", gap: 4, marginBottom: 2 },
  timelineMark: { fontSize: 15 },
  timelineText: { fontSize: 15 },
  timelinePhoto: { width: "100%", height: 180, borderRadius: 8, marginTop: 4, backgroundColor: "#f2f2f7" },
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ebebf0",
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
    backgroundColor: "#06c",
  },
  playerThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#06c",
    marginLeft: -7,
  },
});
