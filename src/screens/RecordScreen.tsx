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
import type { RootStackParamList } from "../navigation/RootNavigator";

type Block = {
  id?: string;
  ms: number;
  text: string;
  kind: "text" | "sys";
  isStarred?: boolean;
  isTodo?: boolean;
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

// App.tsx にあった録音・文字起こしの検証コードをそのまま移植したもの。
// ロジックは変更していない。見た目(スタイル)のみ Claude Design 案(3a)に合わせて調整。
export default function RecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const isPausingRef = useRef(false);       // 意図的な一時停止によるstopか(自動再開・完全終了と区別する)
  const pausedAccumMsRef = useRef(0);       // 一時停止までに経過していた時間の合計(再開後もタイマーを継続させる)
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

  const push = (text: string, kind: Block["kind"] = "text", ms?: number, id?: string) =>
    setBlocks((p) => [...p, { id, ms: ms ?? Date.now() - startedAt.current, text, kind }]);

  const persistTranscriptBlock = (id: string, text: string, startMs: number) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
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
        const id = genId();
        push(text, "text", start, id);
        persistTranscriptBlock(id, text, start);
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

  const pause = () => {
    isPausingRef.current = true;
    shouldRun.current = false; // 自動再開を止める
    pausedAccumMsRef.current += Date.now() - startedAt.current;
    ExpoSpeechRecognitionModule.stop();
    setPaused(true);
  };

  const resume = () => {
    shouldRun.current = true;
    setPaused(false);
    begin(); // audiostartでstartedAt.currentが更新され、経過時間はpausedAccumMsRefに加算して継続する
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

  // 経過時間の表示用ティッカー(一時停止中は加算を止め、再開後は続きから計測する)
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running || paused) return;
    const id = setInterval(
      () => setElapsedMs(pausedAccumMsRef.current + (Date.now() - startedAt.current)),
      200
    );
    return () => clearInterval(id);
  }, [running, paused]);
  useEffect(() => {
    if (!running) {
      setElapsedMs(0);
      pausedAccumMsRef.current = 0;
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
          ) : b.isStarred || b.isTodo ? (
            <View
              key={i}
              style={[
                styles.transcriptMarkedRow,
                { borderLeftColor: b.isStarred ? "#f5a623" : "#34c759" },
              ]}
            >
              <View style={styles.transcriptMarkedHeader}>
                <Ionicons
                  name={b.isStarred ? "star" : "checkmark"}
                  size={13}
                  color={b.isStarred ? "#c98a00" : "#2fa84f"}
                />
                <Text
                  style={[
                    styles.transcriptMarkedTime,
                    { color: b.isStarred ? "#c98a00" : "#2fa84f" },
                  ]}
                >
                  {fmt(b.ms)}
                </Text>
              </View>
              <Text style={styles.transcriptText}>{b.text}</Text>
            </View>
          ) : (
            <View key={i} style={styles.transcriptRow}>
              <Text style={styles.transcriptTime}>{fmt(b.ms)}</Text>
              <Text style={styles.transcriptText}>{b.text}</Text>
            </View>
          )
        )}
        {!blocks.length && !interim ? (
          <Text style={styles.placeholderText}>
            {running ? "話しかけると文字起こしが表示されます" : "「開始」を押すと録音が始まります"}
          </Text>
        ) : null}
        {!running && audioUris.length === 1 ? (
          <Playback uri={audioUris[0]} blocks={blocks} leadSec={leadSec} />
        ) : null}
      </ScrollView>

      <LiveFocusBand text={interim} running={running && !paused} />

      <View style={styles.bottomSection}>
        <View style={styles.bottomCard}>
          <View style={styles.tileRow}>
            {MARK_TILES.map((t) => (
              <MarkTile key={t.key} tile={t} active={activeMark === t.key} onPress={handleMarkPress} />
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

  transcriptArea: { flex: 1, marginTop: 4, paddingHorizontal: 20 },
  transcriptContent: { paddingBottom: 16 },
  transcriptRow: { flexDirection: "row", marginBottom: 10, gap: 8 },
  transcriptTime: { fontSize: 12, color: "#8e8e93", marginTop: 2, width: 40 },
  transcriptText: { fontSize: 16, color: "#1c1c1e", flex: 1, lineHeight: 22 },
  transcriptMarkedRow: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginBottom: 14,
    gap: 3,
  },
  transcriptMarkedHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  transcriptMarkedTime: { fontSize: 13, fontWeight: "700" },
  sysText: { fontSize: 12, color: "#c00", marginBottom: 8 },
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
