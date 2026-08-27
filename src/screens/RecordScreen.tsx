import { useState, useRef, useEffect } from "react";
import {
  Animated,
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
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

type Block = { ms: number; text: string; kind: "text" | "sys" };

const LEVEL_BAR_COUNT = 5;
const KEEP_AWAKE_TAG = "record-screen";

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

// App.tsx にあった録音・文字起こしの検証コードをそのまま移植したもの。
// ロジックは変更していない。見た目(スタイル)のみ Claude Design 案(3a)に合わせて調整。
export default function RecordScreen() {
  const [running, setRunning] = useState(false);
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

  // DB連携用の状態
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef(0);   // セッション全体の開始時刻(音声認識の再起動では変わらない)
  const lastBlockIdRef = useRef<string | null>(null); // 直近確定した文字起こしブロックのID
  const audioSeqRef = useRef(0);           // 音声ファイルの連番(再起動のたびにインクリメント)

  const [questionModalVisible, setQuestionModalVisible] = useState(false);
  const [questionTermInput, setQuestionTermInput] = useState("");
  const [memoModalVisible, setMemoModalVisible] = useState(false);
  const [memoInput, setMemoInput] = useState("");

  const push = (text: string, kind: Block["kind"] = "text", ms?: number) =>
    setBlocks((p) => [...p, { ms: ms ?? Date.now() - startedAt.current, text, kind }]);

  const persistTranscriptBlock = (text: string, startMs: number) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const id = genId();
    lastBlockIdRef.current = id;
    blocksRepo
      .create({ id, sessionId, kind: "transcript", startMs, text })
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

  const toggleStarOnLastBlock = () => {
    const id = lastBlockIdRef.current;
    if (!id) return;
    blocksRepo.toggleStar(id).catch((e) => console.warn("[DB] スター切替に失敗しました", e));
  };

  const toggleTodoOnLastBlock = () => {
    const id = lastBlockIdRef.current;
    if (!id) return;
    blocksRepo.toggleTodo(id).catch((e) => console.warn("[DB] ToDo切替に失敗しました", e));
  };

  const confirmQuestion = () => {
    const id = lastBlockIdRef.current;
    const term = questionTermInput.trim();
    setQuestionModalVisible(false);
    setQuestionTermInput("");
    if (!id) return;
    blocksRepo
      .setQuestion(id, true, term || null)
      .catch((e) => console.warn("[DB] 質問の保存に失敗しました", e));
  };

  const confirmMemo = () => {
    const sessionId = sessionIdRef.current;
    const text = memoInput.trim();
    setMemoModalVisible(false);
    setMemoInput("");
    if (!sessionId || !text) return;
    const startMs = Date.now() - startedAt.current;
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
      const startMs = Date.now() - startedAt.current;

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
    const now = Date.now() - startedAt.current;

    lastResultAt.current = Date.now();
    failStreak.current = 0;

    if (e.isFinal) {
      if (text) {
        // 開始時刻の候補：interim が来ていればそれ、なければ「前の発言の終わり」
        const start = segStart.current ?? prevEnd.current;
        push(text, "text", start);
        persistTranscriptBlock(text, start);
        prevEnd.current = now;      // 今の終わりを、次の発言の開始点にする
        segStart.current = null;    // 空文字finalでリセットすると、同じ発話が続いている場合に開始時刻がズレるため、ここでのみリセット
      }
      setInterim("");
      return;
    }

    if (!text) return;
    if (segStart.current === null) segStart.current = now;
    setInterim(text);
  });

  useSpeechRecognitionEvent("audiostart", () => {
    startedAt.current = Date.now(); // 音声ファイルの0秒とここを一致させる
    segStart.current = null;
    prevEnd.current = 0;
  });

  useSpeechRecognitionEvent("audioend", (e) => {
    if (e.uri) setAudioUris((p) => [...p, e.uri!]);
    const sessionId = sessionIdRef.current;
    if (e.uri && sessionId) {
      const segmentStartedAt = startedAt.current;
      const offsetMs = Math.max(0, segmentStartedAt - sessionStartedAtRef.current);
      const durationMs = Math.max(0, Date.now() - segmentStartedAt);
      const seq = audioSeqRef.current++;
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

  // ここが肝：終了したら、止めたいわけでなければ即座に再開
  useSpeechRecognitionEvent("end", () => {
    if (!shouldRun.current) {
      // 録音用のオーディオセッション(playAndRecord)を解放し、再生時にBluetoothが切れないようにする
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      push("[停止しました]", "sys");
      setRunning(false);
      finalizeSessionDuration();
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
    sessionsRepo
      .create({ id: sessionId, title: "", startedAt: sessionStartedAtRef.current })
      .catch((e) => console.warn("[DB] セッションの作成に失敗しました", e));

    begin();
  };

  const stop = () => {
    shouldRun.current = false;
    ExpoSpeechRecognitionModule.stop();
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

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

  // 経過時間の表示用ティッカー
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 200);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (!running) setElapsedMs(0);
  }, [running]);

  // 録音レベルバーのダミーアニメーション(後で実データに差し替え予定)
  const [levels, setLevels] = useState<number[]>(new Array(LEVEL_BAR_COUNT).fill(4));
  useEffect(() => {
    if (!running) {
      setLevels(new Array(LEVEL_BAR_COUNT).fill(4));
      return;
    }
    const id = setInterval(() => {
      setLevels(
        Array.from({ length: LEVEL_BAR_COUNT }, () => 4 + Math.round(Math.random() * 18))
      );
    }, 220);
    return () => clearInterval(id);
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
        setQuestionModalVisible(true);
        break;
      case "photo":
        handlePhotoCapture();
        break;
      case "memo":
        setMemoModalVisible(true);
        break;
    }
  };

  // 文字起こしリストの自動スクロール
  const scrollRef = useRef<ScrollView>(null);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topSection}>
        <TouchableOpacity
          style={styles.debugButton}
          onPress={() => setShowDebug(true)}
          hitSlop={10}
        >
          <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color="#c7c7cc" />
        </TouchableOpacity>

        <View style={styles.recordingBadge}>
          <View style={[styles.recordingDot, !running && styles.recordingDotIdle]} />
          <Text style={styles.recordingBadgeText}>{running ? "収録中" : "待機中"}</Text>
        </View>

        <Text style={styles.timerText}>{fmt(elapsedMs)}</Text>

        <View style={styles.levelBarsRow}>
          {levels.map((h, i) => (
            <View
              key={i}
              style={[
                styles.levelBar,
                { height: h },
                !running && styles.levelBarIdle,
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {blocks.map((b, i) =>
          b.kind === "sys" ? (
            <Text key={i} style={styles.sysText}>
              [{fmt(b.ms)}] {b.text}
            </Text>
          ) : (
            <View key={i} style={styles.transcriptRow}>
              <Text style={styles.transcriptTime}>{fmt(b.ms)}</Text>
              <Text style={styles.transcriptText}>{b.text}</Text>
            </View>
          )
        )}
        {interim ? <Text style={styles.interimText}>… {interim}</Text> : null}
        {!blocks.length && !interim ? (
          <Text style={styles.placeholderText}>
            {running ? "話しかけると文字起こしが表示されます" : "「開始」を押すと録音が始まります"}
          </Text>
        ) : null}
        {!running && audioUris.length === 1 ? (
          <Playback uri={audioUris[0]} blocks={blocks} leadSec={leadSec} />
        ) : null}
      </ScrollView>

      <View style={styles.bottomSection}>
        <View style={styles.controlCapsule}>
          <TouchableOpacity
            style={styles.controlButtonWhite}
            onPress={running ? stop : start}
            activeOpacity={0.7}
          >
            <Ionicons name={running ? "pause" : "play"} size={26} color="#1c1c1e" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlButtonRed, !running && styles.controlButtonDisabled]}
            onPress={stop}
            disabled={!running}
            activeOpacity={0.7}
          >
            <Ionicons name="square" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.tileRow}>
          {MARK_TILES.map((t) => (
            <MarkTile key={t.key} tile={t} active={activeMark === t.key} onPress={handleMarkPress} />
          ))}
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
    </SafeAreaView>
  );
}

function MarkTile({
  tile,
  active,
  onPress,
}: {
  tile: { key: MarkKey; icon: keyof typeof Ionicons.glyphMap; label: string; border: string; bg: string; tint: string };
  active: boolean;
  onPress: (key: MarkKey) => void;
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
    <TouchableOpacity style={styles.tileWrap} activeOpacity={0.75} onPress={handlePress}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafc" },

  debugButton: { position: "absolute", top: 0, right: 16, zIndex: 1 },

  topSection: { alignItems: "center", paddingTop: 6, paddingBottom: 4 },
  recordingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fdeaea",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3,
    gap: 5,
  },
  recordingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#e0342f" },
  recordingDotIdle: { backgroundColor: "#b8b8bd" },
  recordingBadgeText: { fontSize: 12, color: "#3c3c43", fontWeight: "500" },

  timerText: {
    fontSize: 38,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: "#1c1c1e",
    marginTop: 5,
    fontFamily: "Menlo",
  },

  levelBarsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 16,
    marginTop: 5,
  },
  levelBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: "#8fb4f5",
  },
  levelBarIdle: { backgroundColor: "#e2e2e7" },

  transcriptArea: { flex: 1, marginTop: 4, paddingHorizontal: 20 },
  transcriptContent: { paddingBottom: 16 },
  transcriptRow: { flexDirection: "row", marginBottom: 10, gap: 8 },
  transcriptTime: { fontSize: 12, color: "#8e8e93", marginTop: 2, width: 40 },
  transcriptText: { fontSize: 16, color: "#1c1c1e", flex: 1, lineHeight: 22 },
  interimText: { fontSize: 16, color: "#a0a0a6", marginBottom: 10 },
  sysText: { fontSize: 12, color: "#c00", marginBottom: 8 },
  placeholderText: {
    fontSize: 13,
    color: "#b8b8bd",
    textAlign: "center",
    marginTop: 40,
  },

  bottomSection: { paddingHorizontal: 14, paddingBottom: 8, paddingTop: 4, gap: 10 },

  controlCapsule: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 34,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  controlButtonWhite: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  controlButtonRed: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#e0342f",
    justifyContent: "center",
    alignItems: "center",
  },
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

  debugOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "flex-end" },
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
