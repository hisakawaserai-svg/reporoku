import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import {
  deleteAllAudio,
  deleteSessionAudio,
  formatBytes,
  listNoteStorageEntries,
  totalBytesOf,
  type NoteStorageEntry,
} from "../utils/storageManagement";

function noteDisplayTitle(entry: NoteStorageEntry): string {
  return entry.title || `${formatDateSlash(entry.startedAt)} の記録`;
}

function formatDateSlash(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function StorageManagementScreen() {
  const [entries, setEntries] = useState<NoteStorageEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await listNoteStorageEntries();
      setEntries(rows);
    } catch (e) {
      console.warn("[Storage] 容量一覧の取得に失敗しました", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const totalBytes = totalBytesOf(entries);
  const totalAudioAndPhotoCount = entries.filter((e) => e.hasAudio).length;

  const confirmDeleteSessionAudio = (entry: NoteStorageEntry) => {
    Alert.alert(
      "このノートの音声を削除しますか？",
      `「${noteDisplayTitle(entry)}」の音声ファイルを削除します。文字起こしなどのテキスト記録は残ります。この操作は元に戻せません。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: async () => {
            setDeletingSessionId(entry.sessionId);
            try {
              await deleteSessionAudio(entry.sessionId);
              await load();
            } catch (e) {
              console.warn("[Storage] 音声の削除に失敗しました", e);
              Alert.alert("削除に失敗しました");
            } finally {
              setDeletingSessionId(null);
            }
          },
        },
      ]
    );
  };

  const confirmDeleteAllAudio = () => {
    if (totalAudioAndPhotoCount === 0) return;
    Alert.alert(
      "音声データを一括削除しますか？",
      "全てのノートの音声ファイルを削除します。文字起こしなどのテキスト記録は残ります。この操作は元に戻せません。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "一括削除",
          style: "destructive",
          onPress: async () => {
            setIsBulkDeleting(true);
            try {
              await deleteAllAudio();
              await load();
            } catch (e) {
              console.warn("[Storage] 音声の一括削除に失敗しました", e);
              Alert.alert("一括削除に失敗しました");
            } finally {
              setIsBulkDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>使用容量(音声・写真の合計)</Text>
          <Text style={styles.totalValue}>{formatBytes(totalBytes)}</Text>
        </View>

        <Text style={styles.sectionHeader}>ノートごとの容量</Text>
        {isLoading ? (
          <View style={styles.placeholder}>
            <ActivityIndicator />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.placeholder}>
            <Ionicons name="document-text-outline" size={32} color="#c7c7cc" />
            <Text style={styles.placeholderText}>音声・写真のあるノートはありません</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {entries.map((entry, i) => (
              <View
                key={entry.sessionId}
                style={[styles.row, i < entries.length - 1 && styles.rowDivider]}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {noteDisplayTitle(entry)}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatDateSlash(entry.startedAt)} ・ {formatBytes(entry.bytes)}
                  </Text>
                </View>
                {entry.hasAudio ? (
                  <TouchableOpacity
                    style={styles.rowAction}
                    disabled={deletingSessionId === entry.sessionId}
                    onPress={() => confirmDeleteSessionAudio(entry)}
                  >
                    {deletingSessionId === entry.sessionId ? (
                      <ActivityIndicator size="small" color="#ff3b30" />
                    ) : (
                      <Text style={styles.rowActionText}>音声のみ削除</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.rowActionDone}>音声なし</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.bulkBar}>
        <TouchableOpacity
          style={[
            styles.bulkButton,
            (totalAudioAndPhotoCount === 0 || isBulkDeleting) && styles.bulkButtonDisabled,
          ]}
          disabled={totalAudioAndPhotoCount === 0 || isBulkDeleting}
          onPress={confirmDeleteAllAudio}
        >
          {isBulkDeleting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.bulkButtonText}>音声データを一括削除</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  content: { padding: 16, paddingBottom: 24 },
  totalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    gap: 4,
  },
  totalLabel: { fontSize: 13, color: "#8e8e93" },
  totalValue: { fontSize: 30, fontWeight: "700", color: "#1c1c1e" },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginTop: 20,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  card: { backgroundColor: "#fff", borderRadius: 10, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#c6c6c8" },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#1c1c1e" },
  rowMeta: { fontSize: 12, color: "#8e8e93", marginTop: 3 },
  rowAction: { paddingVertical: 6, paddingHorizontal: 10 },
  rowActionText: { fontSize: 13, color: "#ff3b30", fontWeight: "600" },
  rowActionDone: { fontSize: 12, color: "#c7c7cc" },
  placeholder: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  placeholderText: { color: "#8e8e93", fontSize: 14 },
  bulkBar: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#c6c6c8",
    backgroundColor: "#f2f2f7",
  },
  bulkButton: {
    backgroundColor: "#ff3b30",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  bulkButtonDisabled: { backgroundColor: "#f2b3af" },
  bulkButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
