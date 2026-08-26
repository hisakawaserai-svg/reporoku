import { useState } from "react";
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
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "../navigation/RootNavigator";

type DisplayMode = "list" | "calendar" | "todo" | "glossary";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "list", label: "リスト" },
  { key: "calendar", label: "カレンダー" },
  { key: "todo", label: "Todo" },
  { key: "glossary", label: "用語集" },
];

export default function NotesScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mode, setMode] = useState<DisplayMode>("list");
  const [query, setQuery] = useState("");

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
            <Text style={styles.sectionHeader}>2026年8月</Text>
            {[1, 2, 3].map((i) => (
              <TouchableOpacity
                key={i}
                style={styles.noteRow}
                onPress={() =>
                  navigation.navigate("NoteDetail", { noteId: String(i) })
                }
              >
                <Text style={styles.noteTitle}>2026/08/2{i} の研修</Text>
                <Text style={styles.noteMeta}>
                  14:00 開始 ・ 42分 ・ ★2 📝1 ❓0 📷1 ・ 3.2MB
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {mode === "calendar" && (
          <View style={styles.placeholder}>
            <Ionicons name="calendar-outline" size={32} color="#c7c7cc" />
            <Text style={styles.placeholderText}>カレンダー表示(未実装)</Text>
          </View>
        )}

        {mode === "todo" && (
          <View style={styles.placeholder}>
            <Ionicons name="checkbox-outline" size={32} color="#c7c7cc" />
            <Text style={styles.placeholderText}>Todo一覧(未実装)</Text>
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
