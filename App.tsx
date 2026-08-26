import { useState, useRef, useEffect } from "react";
import { View, Text, Button, ScrollView, StyleSheet, Platform } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

type Block = { ms: number; text: string; kind: "text" | "sys" };

export default function App() {
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

  const push = (text: string, kind: Block["kind"] = "text", ms?: number) =>
    setBlocks((p) => [...p, { ms: ms ?? Date.now() - startedAt.current, text, kind }]);

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
  });

  useSpeechRecognitionEvent("error", (e) => {
    push(`[ERROR] ${e.error} — ${e.message}`, "sys");
  });

  // ここが肝：終了したら、止めたいわけでなければ即座に再開
  useSpeechRecognitionEvent("end", () => {
    if (!shouldRun.current) {
      // 録音用のオーディオセッション(playAndRecord)を解放し、再生時にBluetoothが切れないようにする
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      push("[停止しました]", "sys");
      setRunning(false);
      return;
    }
    failStreak.current += 1;
    if (failStreak.current > 8) {
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      push("[連続失敗のため中断。上のERRORを確認してください]", "sys");
      shouldRun.current = false;
      setRunning(false);
      return;
    }
    setRestarts((n) => n + 1);
    setTimeout(() => {
      if (shouldRun.current) begin();
    }, 150);
  });

  const useExternalicMic = false; // 外部マイクを使う場合は true にする

  const begin = () => {
    ExpoSpeechRecognitionModule.start({
      lang: "ja-JP",
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      recordingOptions: { persist: true },
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
    lastResultAt.current = Date.now();
    failStreak.current = 0;
    shouldRun.current = true;
    setBlocks([]);
    setAudioUris([]);
    setRestarts(0);
    setRunning(true);
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

  return (
    <View style={styles.container}>
      <Text style={styles.mono}>{diag}</Text>

      <View style={styles.gap}>
        <Button
          title={running ? "停止" : "開始"}
          onPress={running ? stop : start}
          color={running ? "#c00" : undefined}
        />
      </View>

      <Text style={styles.mono}>
        再起動 {restarts} 回 / 音声ファイル {audioUris.length} 個
      </Text>

      <View style={[styles.gap, styles.row]}>
        <Button title="-0.2" onPress={() => setLeadSec((v) => Math.round((v - 0.2) * 10) / 10)} />
        <Text style={styles.mono}>手前 {leadSec.toFixed(1)} 秒</Text>
        <Button title="+0.2" onPress={() => setLeadSec((v) => Math.round((v + 0.2) * 10) / 10)} />
      </View>

      <ScrollView style={styles.log}>
        {blocks.map((b, i) => (
          <Text key={i} style={[styles.line, b.kind === "sys" && styles.sys]}>
            [{fmt(b.ms)}] {b.text}
          </Text>
        ))}
        {interim ? <Text style={styles.interim}>… {interim}</Text> : null}
        {!running && audioUris.length === 1 ? (
          <Playback uri={audioUris[0]} blocks={blocks} leadSec={leadSec} />
        ) : null}
      </ScrollView>
      <Button title="生ログを表示" onPress={() => setShowLog(rawLog.current.join("\n"))} />
      <Text style={styles.mono}>{showLog}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  gap: { marginVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  log: { flex: 1, marginTop: 12 },
  line: { fontSize: 15, marginBottom: 6 },
  sys: { color: "#c00", fontSize: 12 },
  interim: { fontSize: 15, color: "#888" },
  mono: { fontSize: 11, color: "#555", marginTop: 6 },
});

import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { TouchableOpacity } from "react-native";

function Playback({ uri, blocks, leadSec }: { uri: string; blocks: Block[]; leadSec: number }) {
  const player = useAudioPlayer({ uri });

  return (
    <View style={{ marginTop: 12 }}>
      <Button title="▶ 最初から再生" onPress={() => { player.seekTo(0); player.play(); }} />
      <Button title="⏸ 一時停止" onPress={() => player.pause()} />
      <Text style={styles.mono}>長さ: {Math.round(player.duration ?? 0)} 秒</Text>
      <Text style={styles.mono}>手前 {leadSec.toFixed(1)} 秒から再生</Text>

      <Text style={{ marginTop: 8, fontWeight: "600" }}>タップでその位置から再生：</Text>
      {blocks
        .filter((b) => b.kind === "text")
        .map((b, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => {
              player.seekTo(Math.max(0, b.ms / 1000 - leadSec));
              player.play();
            }}
          >
            <Text style={{ fontSize: 15, marginVertical: 4, color: "#06c" }}>
              [{String(Math.floor(b.ms / 1000 / 60)).padStart(2, "0")}:
              {String(Math.floor(b.ms / 1000) % 60).padStart(2, "0")}] {b.text}
            </Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}