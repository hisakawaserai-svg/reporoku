import { useCallback, useLayoutEffect, useState } from "react";
import { Image, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as blocksRepo from "../db/repositories/blocks";
import type { Block } from "../db/types";

type FilterKey = "all" | "star" | "todo" | "question" | "photo";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "star", label: "★" },
  { key: "todo", label: "📝" },
  { key: "question", label: "❓" },
  { key: "photo", label: "📷" },
];

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
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
  const [filter, setFilter] = useState<FilterKey>("all");
  const [blocks, setBlocks] = useState<Block[]>([]);

  const loadBlocks = useCallback(async () => {
    try {
      const rows = await blocksRepo.listBySessionId(sessionId);
      setBlocks(rows);
    } catch (e) {
      console.warn("[DB] ブロック一覧の取得に失敗しました", e);
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      loadBlocks();
    }, [loadBlocks])
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate("Report", { noteId: sessionId })}
        >
          <Text style={styles.headerButton}>レポート出力</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, sessionId]);

  const filtered = blocks.filter((b) => matchesFilter(b, filter));

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

      <ScrollView style={styles.timeline}>
        {filtered.length === 0 ? (
          <Text style={styles.emptyText}>表示できるブロックがありません</Text>
        ) : (
          filtered.map((block) => (
            <View key={block.id} style={styles.timelineRow}>
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
            </View>
          ))
        )}
      </ScrollView>
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
  timelineTime: { fontSize: 12, color: "#8e8e93", marginRight: 8, marginTop: 2 },
  timelineBody: { flex: 1 },
  timelineMarksRow: { flexDirection: "row", gap: 4, marginBottom: 2 },
  timelineMark: { fontSize: 15 },
  timelineText: { fontSize: 15 },
  timelinePhoto: { width: "100%", height: 180, borderRadius: 8, marginTop: 4, backgroundColor: "#f2f2f7" },
  questionTermText: { fontSize: 12, color: "#7c4dff", marginTop: 4 },
  emptyText: { color: "#8e8e93", fontSize: 14, textAlign: "center", marginTop: 40 },
});
