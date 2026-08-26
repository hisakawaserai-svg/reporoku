import { useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";

import type { RootStackParamList } from "../navigation/RootNavigator";

type Template = "summary" | "full";

const TEMPLATES: { key: Template; label: string; description: string }[] = [
  { key: "summary", label: "要点抜粋", description: "★・📝・写真のみ(デフォルト)" },
  { key: "full", label: "全文", description: "文字起こし全体を含む" },
];

export default function ReportScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Report">>();
  const [template, setTemplate] = useState<Template>("summary");

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>テンプレート</Text>
        <View style={styles.templateGroup}>
          {TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.templateCard, template === t.key && styles.templateCardSelected]}
              onPress={() => setTemplate(t.key)}
            >
              <View
                style={[styles.radio, template === t.key && styles.radioSelected]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.templateLabel}>{t.label}</Text>
                <Text style={styles.templateDescription}>{t.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>プレビュー</Text>
        <View style={styles.previewBox}>
          <Text style={styles.previewText}>
            {"【受講報告】新入社員セキュリティ研修\n"}
            {"日時：2026/08/26 14:00〜16:00\n\n"}
            {"■ 重要なポイント\n"}
            {"・[00:47] パスワードは使い回さないこと\n\n"}
            {"■ 今後のアクション\n"}
            {"・[01:30] 8/30までに2段階認証の設定を完了させる"}
          </Text>
        </View>

        <Text style={styles.sectionHeader}>書き出し方法</Text>
        <View style={styles.card}>
          {["クリップボードにコピー", "共有シート", "テキストファイルとして保存"].map(
            (label, i, arr) => (
              <TouchableOpacity
                key={label}
                style={[styles.row, i < arr.length - 1 && styles.rowDivider]}
              >
                <Text style={styles.rowLabel}>{label}</Text>
              </TouchableOpacity>
            )
          )}
        </View>

        <Text style={styles.noteIdHint}>note: {route.params.noteId}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  content: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginBottom: 6,
    marginTop: 16,
    textTransform: "uppercase",
  },
  templateGroup: { gap: 10 },
  templateCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  templateCardSelected: { borderColor: "#06c" },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#c7c7cc",
    marginRight: 12,
  },
  radioSelected: { borderColor: "#06c", backgroundColor: "#06c" },
  templateLabel: { fontSize: 16, fontWeight: "600" },
  templateDescription: { fontSize: 13, color: "#8e8e93", marginTop: 2 },
  previewBox: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  previewText: { fontSize: 13, lineHeight: 20, color: "#1c1c1e" },
  card: { backgroundColor: "#fff", borderRadius: 10, overflow: "hidden" },
  row: { paddingVertical: 12, paddingHorizontal: 14 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#c6c6c8" },
  rowLabel: { fontSize: 16, color: "#06c" },
  noteIdHint: { marginTop: 20, fontSize: 11, color: "#c7c7cc" },
});
