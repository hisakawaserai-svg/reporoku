import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { seedDevTestData } from "../utils/devTestData";
import type { RootStackParamList } from "../navigation/RootNavigator";
import {
  SECTION_GAP_OPTIONS,
  getDefaultSectionGapMs,
  getSectionGroupingEnabled,
  setDefaultSectionGapMs,
  setSectionGroupingEnabled,
} from "../utils/settings";

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string };
type Section = { title: string; rows: Row[] };

const SECTIONS: Section[] = [
  {
    title: "再生",
    rows: [{ icon: "play-outline", label: "再生開始位置(lead)", value: "1.2秒" }],
  },
  {
    title: "録音",
    rows: [
      { icon: "mic-outline", label: "音声の品質 / サンプルレート", value: "標準" },
      { icon: "bluetooth-outline", label: "外部マイクを使う", value: "オフ" },
    ],
  },
  {
    title: "ストレージ管理",
    rows: [
      { icon: "server-outline", label: "総使用容量", value: "—" },
      { icon: "list-outline", label: "ノートごとの容量一覧" },
      { icon: "trash-outline", label: "音声データのみ削除" },
    ],
  },
  {
    title: "バックアップ",
    rows: [{ icon: "share-outline", label: "zipで書き出す" }],
  },
  {
    title: "アプリ情報",
    rows: [
      { icon: "language-outline", label: "言語", value: "日本語" },
      { icon: "document-text-outline", label: "利用規約" },
      { icon: "shield-checkmark-outline", label: "プライバシーポリシー" },
      { icon: "code-slash-outline", label: "オープンソースライセンス" },
      { icon: "mail-outline", label: "お問い合わせ" },
    ],
  },
];

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [isSeeding, setIsSeeding] = useState(false);
  const [sectionGroupingEnabled, setSectionGroupingEnabledState] = useState(getSectionGroupingEnabled);
  const [defaultSectionGapMs, setDefaultSectionGapMsState] = useState(getDefaultSectionGapMs);

  const handleToggleSectionGrouping = (value: boolean) => {
    setSectionGroupingEnabledState(value);
    setSectionGroupingEnabled(value);
  };

  const handleSelectDefaultSectionGap = (ms: number) => {
    setDefaultSectionGapMsState(ms);
    setDefaultSectionGapMs(ms);
  };

  const handleSeedTestData = async () => {
    if (isSeeding) return;
    setIsSeeding(true);
    try {
      await seedDevTestData();
      Alert.alert("テストデータを追加しました");
    } catch (e) {
      console.warn("[Dev] テストデータの投入に失敗しました", e);
      Alert.alert("テストデータの投入に失敗しました");
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>設定</Text>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.card}>
              {section.rows.map((row, i) => (
                <TouchableOpacity
                  key={row.label}
                  style={[
                    styles.row,
                    i < section.rows.length - 1 && styles.rowDivider,
                  ]}
                >
                  <Ionicons name={row.icon} size={20} color="#06c" style={styles.rowIcon} />
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  {row.value ? <Text style={styles.rowValue}>{row.value}</Text> : null}
                  <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>タイムライン表示</Text>
          <View style={styles.card}>
            <View style={[styles.row, styles.rowDivider]}>
              <Ionicons name="layers-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>セクション分けを表示する</Text>
              <Switch value={sectionGroupingEnabled} onValueChange={handleToggleSectionGrouping} />
            </View>
            <View style={styles.gapRow}>
              <Text style={styles.rowLabel}>新しい録音のデフォルト間隔</Text>
              <View style={styles.gapOptionRow}>
                {SECTION_GAP_OPTIONS.map((opt) => {
                  const selected = opt.ms === defaultSectionGapMs;
                  return (
                    <TouchableOpacity
                      key={opt.ms}
                      style={[styles.gapOption, selected && styles.gapOptionSelected]}
                      onPress={() => handleSelectDefaultSectionGap(opt.ms)}
                    >
                      <Text style={[styles.gapOptionText, selected && styles.gapOptionTextSelected]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.gapHint}>
                新しく録音を開始した時の初期値です。既存のノートの間隔には影響しません。
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ヘルプ</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Onboarding")}>
              <Ionicons name="help-circle-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>アプリの使い方を見る</Text>
              <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            </TouchableOpacity>
          </View>
        </View>

        {__DEV__ ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>開発者向け</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                disabled={isSeeding}
                onPress={handleSeedTestData}
              >
                <Ionicons name="flask-outline" size={20} color="#06c" style={styles.rowIcon} />
                <Text style={styles.rowLabel}>
                  {isSeeding ? "投入中…" : "テストデータを投入する"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  content: { paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: "700", marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
  section: { marginTop: 20 },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginHorizontal: 16,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#c6c6c8",
  },
  rowIcon: { marginRight: 10 },
  rowLabel: { flex: 1, fontSize: 16 },
  rowValue: { fontSize: 15, color: "#8e8e93", marginRight: 6 },
  gapRow: { paddingVertical: 12, paddingHorizontal: 12, gap: 10 },
  gapOptionRow: { flexDirection: "row", gap: 8 },
  gapOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#f2f2f7",
    alignItems: "center",
  },
  gapOptionSelected: { backgroundColor: "#06c" },
  gapOptionText: { fontSize: 14, fontWeight: "600", color: "#3c3c43" },
  gapOptionTextSelected: { color: "#fff" },
  gapHint: { fontSize: 12, color: "#8e8e93" },
});
