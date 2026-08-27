import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";

function formatTime(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60000);
  return `${totalMinutes}分`;
}

// 録音終了時の確認画面。
// モーダルではなく通常の画面として遷移させることで、閉じてしまって二度と
// タイトル入力やノートへの導線に戻れなくなる、という問題を避けている。
export default function RecordCompleteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "RecordComplete">>();
  const sessionId = route.params.noteId;

  const [startedAt, setStartedAt] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [title, setTitle] = useState("");
  const [counts, setCounts] = useState({ star: 0, todo: 0, question: 0, photo: 0 });

  useEffect(() => {
    (async () => {
      try {
        const session = await sessionsRepo.getById(sessionId);
        if (session) {
          setStartedAt(session.startedAt);
          setDurationMs(session.durationMs);
          setTitle(session.title);
        }
        const blocks = await blocksRepo.listBySessionId(sessionId);
        setCounts({
          star: blocks.filter((b) => b.isStarred).length,
          todo: blocks.filter((b) => b.isTodo).length,
          question: blocks.filter((b) => b.isQuestion).length,
          photo: blocks.filter((b) => b.kind === "photo").length,
        });
      } catch (e) {
        console.warn("[DB] 録音完了画面の読み込みに失敗しました", e);
      }
    })();
  }, [sessionId]);

  const commitTitle = useCallback(() => {
    sessionsRepo
      .updateTitle(sessionId, title.trim())
      .catch((e) => console.warn("[DB] タイトルの保存に失敗しました", e));
  }, [sessionId, title]);

  const handleViewNote = () => {
    commitTitle();
    navigation.replace("NoteDetail", { noteId: sessionId });
  };

  const handleClose = () => {
    commitTitle();
    navigation.goBack();
  };

  const defaultTitle = startedAt ? `${formatTime(startedAt)} の記録` : "";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={36} color="#2fa84f" />
        </View>
        <Text style={styles.heading}>録音を保存しました</Text>
        <Text style={styles.subheading}>
          {startedAt ? `${formatTime(startedAt)} 開始 ・ ${formatDuration(durationMs)}` : ""}
        </Text>

        <Text style={styles.fieldLabel}>名前(任意)</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          onBlur={commitTitle}
          placeholder={defaultTitle}
          placeholderTextColor="#b8b8bd"
        />

        <View style={styles.countsRow}>
          <View style={styles.countItem}>
            <Ionicons name="star" size={16} color="#c98a00" />
            <Text style={styles.countText}>{counts.star}</Text>
          </View>
          <View style={styles.countItem}>
            <Ionicons name="checkmark-circle" size={16} color="#2fa84f" />
            <Text style={styles.countText}>{counts.todo}</Text>
          </View>
          <View style={styles.countItem}>
            <Ionicons name="help-circle" size={16} color="#7c4dff" />
            <Text style={styles.countText}>{counts.question}</Text>
          </View>
          <View style={styles.countItem}>
            <Ionicons name="camera" size={16} color="#57575c" />
            <Text style={styles.countText}>{counts.photo}</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.85} onPress={handleViewNote}>
          <Text style={styles.primaryButtonText}>ノートを見る</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.7} onPress={handleClose}>
          <Text style={styles.secondaryButtonText}>閉じる</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { flex: 1, alignItems: "center", paddingTop: 48, paddingHorizontal: 32 },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#eafbee",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  heading: { fontSize: 20, fontWeight: "700", color: "#1c1c1e" },
  subheading: { fontSize: 14, color: "#8e8e93", marginTop: 6 },

  fieldLabel: { alignSelf: "flex-start", fontSize: 13, color: "#8e8e93", marginTop: 32 },
  titleInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e2e2e7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#1c1c1e",
    marginTop: 8,
  },

  countsRow: { flexDirection: "row", gap: 20, marginTop: 28 },
  countItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  countText: { fontSize: 14, color: "#3c3c43", fontWeight: "600" },

  footer: { paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: "#06c",
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  secondaryButton: { height: 44, justifyContent: "center", alignItems: "center" },
  secondaryButtonText: { fontSize: 15, color: "#8e8e93" },
});
