import { useLayoutEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";

import type { RootStackParamList } from "../navigation/RootNavigator";

type FilterKey = "all" | "star" | "todo" | "question" | "photo";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "star", label: "★" },
  { key: "todo", label: "📝" },
  { key: "question", label: "❓" },
  { key: "photo", label: "📷" },
];

type TimelineItem = {
  ms: number;
  kind: "text" | "star" | "todo" | "question" | "photo";
  text: string;
};

const DUMMY_TIMELINE: TimelineItem[] = [
  { ms: 3000, kind: "text", text: "本日はセキュリティ研修を…" },
  { ms: 47000, kind: "star", text: "パスワードは使い回さないこと" },
  { ms: 72000, kind: "photo", text: "[スライド写真]" },
  { ms: 90000, kind: "todo", text: "8/30までに2段階認証を設定" },
  { ms: 120000, kind: "question", text: "シフトレフトとは？" },
];

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function markFor(kind: TimelineItem["kind"]) {
  switch (kind) {
    case "star":
      return { mark: "★", color: "#e0a800" };
    case "todo":
      return { mark: "📝", color: "#06c" };
    case "question":
      return { mark: "❓", color: "#7c4dff" };
    case "photo":
      return { mark: "📷", color: "#555" };
    default:
      return null;
  }
}

export default function NoteDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "NoteDetail">>();
  const [filter, setFilter] = useState<FilterKey>("all");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate("Report", { noteId: route.params.noteId })}
        >
          <Text style={styles.headerButton}>レポート出力</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, route.params.noteId]);

  const filtered = DUMMY_TIMELINE.filter((item) => {
    if (filter === "all") return true;
    if (filter === "star") return item.kind === "star";
    if (filter === "todo") return item.kind === "todo";
    if (filter === "question") return item.kind === "question";
    if (filter === "photo") return item.kind === "photo";
    return true;
  });

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
        {filtered.map((item, i) => {
          const mark = markFor(item.kind);
          return (
            <View key={i} style={styles.timelineRow}>
              <Text style={styles.timelineTime}>[{fmt(item.ms)}]</Text>
              {mark ? (
                <Text style={[styles.timelineMark, { color: mark.color }]}>{mark.mark}</Text>
              ) : null}
              <Text style={styles.timelineText}>{item.text}</Text>
            </View>
          );
        })}
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
  timelineMark: { fontSize: 15, marginRight: 6 },
  timelineText: { fontSize: 15, flex: 1 },
});
