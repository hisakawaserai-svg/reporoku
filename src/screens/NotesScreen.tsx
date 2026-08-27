import { useCallback, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import type { BlockWithSession, MonthGroup, Session } from "../db/types";

type DisplayMode = "list" | "calendar" | "todo" | "glossary";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "list", label: "リスト" },
  { key: "calendar", label: "カレンダー" },
  { key: "todo", label: "Todo" },
  { key: "glossary", label: "用語集" },
];

type SessionSummary = Session & {
  starCount: number;
  todoCount: number;
  questionCount: number;
  photoCount: number;
};

type TodoGroups = { pending: BlockWithSession[]; done: BlockWithSession[] };

function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function formatTime(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60000);
  return `${totalMinutes}分`;
}

function fmtBlockTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function NotesScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mode, setMode] = useState<DisplayMode>("list");
  const [query, setQuery] = useState("");
  const [monthGroups, setMonthGroups] = useState<MonthGroup<SessionSummary>[]>([]);
  const [todos, setTodos] = useState<TodoGroups>({ pending: [], done: [] });

  const loadNotes = useCallback(async () => {
    try {
      const groups = await sessionsRepo.listAllGroupedByMonth();
      const summarized: MonthGroup<SessionSummary>[] = await Promise.all(
        groups.map(async (group) => ({
          monthKey: group.monthKey,
          items: await Promise.all(
            group.items.map(async (session) => {
              const blocks = await blocksRepo.listBySessionId(session.id);
              return {
                ...session,
                starCount: blocks.filter((b) => b.isStarred).length,
                todoCount: blocks.filter((b) => b.isTodo).length,
                questionCount: blocks.filter((b) => b.isQuestion).length,
                photoCount: blocks.filter((b) => b.kind === "photo").length,
              };
            })
          ),
        }))
      );
      setMonthGroups(summarized);
    } catch (e) {
      console.warn("[DB] ノート一覧の取得に失敗しました", e);
    }
  }, []);

  const loadTodos = useCallback(async () => {
    try {
      const groups = await blocksRepo.listAllTodos();
      setTodos(groups);
    } catch (e) {
      console.warn("[DB] Todo一覧の取得に失敗しました", e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadNotes();
      loadTodos();
    }, [loadNotes, loadTodos])
  );

  const renderTodoRow = (block: BlockWithSession) => (
    <TouchableOpacity
      key={block.id}
      style={styles.noteRow}
      onPress={() => navigation.navigate("NoteDetail", { noteId: block.sessionId })}
    >
      <Text style={styles.noteTitle}>{block.text}</Text>
      <Text style={styles.noteMeta}>
        {block.sessionTitle || "無題のノート"} ・ {fmtBlockTime(block.startMs)}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 検索バー */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8e8e93" />
        <TextInput
          style={styles.searchInput}
          placeholder="ノートを検索"
          placeholderTextColor="#8e8e93"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {/* セグメントコントロール */}
      <View style={styles.segmentedControl}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[
              styles.segment,
              mode === m.key && styles.segmentSelected,
            ]}
            onPress={() => setMode(m.key)}
          >
            <Text
              style={[
                styles.segmentText,
                mode === m.key && styles.segmentTextSelected,
              ]}
            >
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content}>
        {mode === "list" && (
          <View>
            {monthGroups.length === 0 ? (
              <View style={styles.placeholder}>
                <Ionicons name="document-text-outline" size={32} color="#c7c7cc" />
                <Text style={styles.placeholderText}>まだ記録がありません</Text>
              </View>
            ) : (
              monthGroups.map((group) => (
                <View key={group.monthKey}>
                  <Text style={styles.sectionHeader}>{formatMonthKey(group.monthKey)}</Text>
                  {group.items.map((session) => (
                    <TouchableOpacity
                      key={session.id}
                      style={styles.noteRow}
                      onPress={() =>
                        navigation.navigate("NoteDetail", { noteId: session.id })
                      }
                    >
                      <Text style={styles.noteTitle}>
                        {session.title || `${formatTime(session.startedAt)} の記録`}
                      </Text>
                      <Text style={styles.noteMeta}>
                        {formatTime(session.startedAt)} 開始 ・ {formatDuration(session.durationMs)}
                        {" ・ "}★{session.starCount} 📝{session.todoCount} ❓
                        {session.questionCount} 📷{session.photoCount}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}
          </View>
        )}

        {mode === "calendar" && (
          <View style={styles.placeholder}>
            <Ionicons name="calendar-outline" size={32} color="#c7c7cc" />
            <Text style={styles.placeholderText}>カレンダー表示(未実装)</Text>
          </View>
        )}

        {mode === "todo" && (
          <View>
            {todos.pending.length === 0 && todos.done.length === 0 ? (
              <View style={styles.placeholder}>
                <Ionicons name="checkbox-outline" size={32} color="#c7c7cc" />
                <Text style={styles.placeholderText}>Todoはまだありません</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionHeader}>未完了</Text>
                {todos.pending.length === 0 ? (
                  <Text style={styles.emptyGroupText}>なし</Text>
                ) : (
                  todos.pending.map(renderTodoRow)
                )}
                <Text style={styles.sectionHeader}>完了</Text>
                {todos.done.length === 0 ? (
                  <Text style={styles.emptyGroupText}>なし</Text>
                ) : (
                  todos.done.map(renderTodoRow)
                )}
              </>
            )}
          </View>
        )}

        {mode === "glossary" && (
          <View style={styles.placeholder}>
            <Ionicons name="help-circle-outline" size={32} color="#c7c7cc" />
            <Text style={styles.placeholderText}>用語集(未実装)</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ebebf0",
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 10,
    height: 36,
  },
  searchInput: { flex: 1, marginLeft: 6, fontSize: 15 },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: "#ebebf0",
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  segmentSelected: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1,
    elevation: 1,
  },
  segmentText: { fontSize: 13, color: "#3c3c43" },
  segmentTextSelected: { fontWeight: "600" },
  content: { flex: 1, marginTop: 12 },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginHorizontal: 16,
    marginBottom: 4,
    marginTop: 12,
  },
  emptyGroupText: {
    fontSize: 13,
    color: "#c7c7cc",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  noteRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#c6c6c8",
  },
  noteTitle: { fontSize: 16, fontWeight: "500" },
  noteMeta: { fontSize: 12, color: "#8e8e93", marginTop: 2 },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 8,
  },
  placeholderText: { color: "#8e8e93", fontSize: 14 },
});
