import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// ★の「グループを設定」専用のフォーム。ノート詳細画面(タイムライン中にインライン展開)・
// まとめ画面(モーダル)の両方から、中身だけをこのコンポーネントとして共有する。
// 既存グループが多い場合に備えて検索欄+ラジオ選択の一覧を持つ
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
  existingGroups: string[];
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const sorted = [...existingGroups].sort((a, b) => a.localeCompare(b, "ja"));
    const query = search.trim().toLowerCase();
    return query ? sorted.filter((name) => name.toLowerCase().includes(query)) : sorted;
  }, [existingGroups, search]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>グループを設定</Text>
      <Text style={styles.description}>
        同じような★をノートをまたいで束ねられます。空にすると未分類に戻ります。
      </Text>

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
            filteredGroups.map((name) => {
              const selected = value === name;
              return (
                <TouchableOpacity
                  key={name}
                  style={[styles.radioRow, selected && styles.radioRowSelected]}
                  activeOpacity={0.7}
                  onPress={() => onChangeText(name)}
                >
                  <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                  <Text style={styles.radioLabel}>{name}</Text>
                </TouchableOpacity>
              );
            })
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
    borderRadius: 20,
    padding: 20,
    marginVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#1c1c1e", marginBottom: 8 },
  description: { fontSize: 13, color: "#8e8e93", lineHeight: 18, marginBottom: 16 },
  input: {
    borderWidth: 1.5,
    borderColor: "#d98c00",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#1c1c1e",
    backgroundColor: "#fdf6e8",
  },
  divider: { height: 1, backgroundColor: "#e5e5ea", marginVertical: 16 },
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
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  radioRowSelected: { backgroundColor: "#fdf0dc" },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#d1d1d6",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: { borderColor: "#d98c00" },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#d98c00" },
  radioLabel: { fontSize: 16, color: "#1c1c1e" },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 20,
    marginTop: 18,
  },
  cancelText: { fontSize: 16, color: "#8e8e93", fontWeight: "600" },
  saveButton: {
    backgroundColor: "#d98c00",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 22,
  },
  saveButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
