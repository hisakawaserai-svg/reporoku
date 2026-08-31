import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ImportantGroupSummary } from "../db/repositories/blocks";
import * as colors from "../theme/colors";
import { radius, spacing } from "../theme/spacing";

// ★の「グループを設定」専用のフォーム。ノート詳細画面(タイムライン中にインライン展開)・
// まとめ画面(モーダル)の両方から、中身だけをこのコンポーネントとして共有する。
// 既存グループが多い場合に備えて検索欄+ラジオ選択の一覧を持つ。
// タイトルだけでは中身が分からず選びにくいため、件数と直近の一言メモも表示する
export default function GroupSettingForm({
  value,
  onChangeText,
  existingGroups,
  onCancel,
  onConfirm,
  confirmLabel = "保存",
}: {
  value: string;
  onChangeText: (text: string) => void;
  existingGroups: ImportantGroupSummary[];
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const sorted = [...existingGroups].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    const query = search.trim().toLowerCase();
    return query ? sorted.filter((g) => g.name.toLowerCase().includes(query)) : sorted;
  }, [existingGroups, search]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>グループを設定</Text>

      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder="新しいグループ名(例: 朝の出勤時にやること)"
        autoFocus
      />

      {existingGroups.length > 0 ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>既存のグループから選ぶ</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="グループ名で検索"
              placeholderTextColor="#8e8e93"
            />
          </View>
          {filteredGroups.length === 0 ? (
            <Text style={styles.emptyText}>一致するグループがありません</Text>
          ) : (
            <ScrollView
              style={styles.radioList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {filteredGroups.map((group) => {
                const selected = value === group.name;
                return (
                  <TouchableOpacity
                    key={group.name}
                    style={[styles.radioRow, selected && styles.radioRowSelected]}
                    activeOpacity={0.7}
                    onPress={() => onChangeText(group.name)}
                  >
                    <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                      {selected ? <View style={styles.radioInner} /> : null}
                    </View>
                    <View style={styles.radioTextArea}>
                      <View style={styles.radioTitleRow}>
                        <Text style={styles.radioLabel}>{group.name}</Text>
                        <Text style={styles.radioCount}>{group.count}件</Text>
                      </View>
                      {group.latestSample ? (
                        <Text style={styles.radioPreview} numberOfLines={1}>
                          {group.latestSample}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </>
      ) : null}

      <View style={styles.footer}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveButton} onPress={onConfirm}>
          <Text style={styles.saveButtonText}>{confirmLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.formCard,
    padding: spacing.formCardPadding,
    marginVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#1c1c1e", marginBottom: 10 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.star.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#1c1c1e",
    backgroundColor: colors.star.background,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 16 },
  sectionLabel: { fontSize: 13, color: "#8e8e93", marginBottom: 10 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f2f2f7",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 14, color: "#1c1c1e", padding: 0 },
  emptyText: { fontSize: 13, color: "#c7c7cc", marginBottom: 8 },
  // キーボード表示時は画面の見える高さ自体が大きく縮むため、グループ一覧はここだけで
  // スクロールさせ、カード全体が画面外へ押し出されないようにする
  radioList: { maxHeight: 180 },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  radioRowSelected: { backgroundColor: colors.star.background },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#d1d1d6",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: { borderColor: colors.star.accent },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.star.accent },
  radioTextArea: { flex: 1 },
  radioTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  radioLabel: { fontSize: 16, color: "#1c1c1e" },
  radioCount: { fontSize: 12, color: "#8e8e93" },
  radioPreview: { fontSize: 12, color: "#8e8e93", marginTop: 2, lineHeight: 16 },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 20,
    marginTop: 18,
  },
  cancelText: { fontSize: 16, color: "#8e8e93", fontWeight: "600" },
  saveButton: {
    backgroundColor: colors.star.accent,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 22,
  },
  saveButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
