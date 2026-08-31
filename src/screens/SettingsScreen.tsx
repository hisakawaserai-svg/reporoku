import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Directory } from "expo-file-system";
import { seedDevTestData } from "../utils/devTestData";
import type { RootStackParamList } from "../navigation/RootNavigator";
import {
  PLAYBACK_LEAD_DEFAULT_SEC,
  PLAYBACK_LEAD_MAX_SEC,
  PLAYBACK_LEAD_MIN_SEC,
  PLAYBACK_LEAD_STEP_SEC,
  SAMPLE_RATE_OPTIONS,
  SECTION_GAP_OPTIONS,
  getAllowBluetoothMic,
  getDefaultSectionGapMs,
  getPlaybackLeadSec,
  getRecordingSampleRate,
  getSectionGroupingEnabled,
  setAllowBluetoothMic,
  setDefaultSectionGapMs,
  setPlaybackLeadSec,
  setRecordingSampleRate,
  setSectionGroupingEnabled,
} from "../utils/settings";
import { createBackupZip } from "../utils/backup";
import {
  InvalidBackupError,
  RestoreRollbackFailedError,
  applyBackup,
  discardExtractedBackup,
  extractAndValidateBackup,
} from "../utils/restore";
import {
  deleteOrphanFiles,
  findOrphanFiles,
  formatBytes,
  listNoteStorageEntries,
  totalBytesOf,
} from "../utils/storageManagement";
import * as colors from "../theme/colors";
import { radius, spacing } from "../theme/spacing";
import { fontSize } from "../theme/typography";

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string };
type Section = { title: string; rows: Row[] };

const SECTIONS: Section[] = [
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
  const [playbackLeadSec, setPlaybackLeadSecState] = useState(getPlaybackLeadSec);
  const [recordingSampleRate, setRecordingSampleRateState] = useState(getRecordingSampleRate);
  const [allowBluetoothMic, setAllowBluetoothMicState] = useState(getAllowBluetoothMic);
  const [totalStorageLabel, setTotalStorageLabel] = useState("—");
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isCheckingOrphans, setIsCheckingOrphans] = useState(false);
  const [isDeletingOrphans, setIsDeletingOrphans] = useState(false);

  // 長押しでの連続変更中、setIntervalのコールバックが最新値を参照できるようにstateと並行して保持する
  const playbackLeadSecRef = useRef(playbackLeadSec);
  useEffect(() => {
    playbackLeadSecRef.current = playbackLeadSec;
  }, [playbackLeadSec]);
  const leadRepeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadRepeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopLeadRepeat = useCallback(() => {
    if (leadRepeatTimeoutRef.current) {
      clearTimeout(leadRepeatTimeoutRef.current);
      leadRepeatTimeoutRef.current = null;
    }
    if (leadRepeatIntervalRef.current) {
      clearInterval(leadRepeatIntervalRef.current);
      leadRepeatIntervalRef.current = null;
    }
  }, []);
  useEffect(() => stopLeadRepeat, [stopLeadRepeat]);

  const refreshTotalStorageLabel = useCallback(() => {
    listNoteStorageEntries()
      .then((entries) => setTotalStorageLabel(formatBytes(totalBytesOf(entries))))
      .catch((e) => console.warn("[Storage] 使用容量の取得に失敗しました", e));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshTotalStorageLabel();
    }, [refreshTotalStorageLabel])
  );

  const handleDeleteOrphanFiles = async () => {
    if (isCheckingOrphans || isDeletingOrphans) return;
    setIsCheckingOrphans(true);
    let summary;
    try {
      summary = await findOrphanFiles();
    } catch (e) {
      console.warn("[Storage] 不要なファイルの確認に失敗しました", e);
      Alert.alert("確認に失敗しました");
      return;
    } finally {
      setIsCheckingOrphans(false);
    }

    const count = summary.audioUris.length + summary.photoUris.length;
    if (count === 0) {
      Alert.alert("不要なファイルは見つかりませんでした");
      return;
    }

    Alert.alert(
      "不要なファイルを削除しますか？",
      `どのノートからも参照されていないファイルが${count}件(${formatBytes(
        summary.bytes
      )})見つかりました。削除してもノートの内容には影響しません。この操作は元に戻せません。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: async () => {
            setIsDeletingOrphans(true);
            try {
              await deleteOrphanFiles(summary);
              refreshTotalStorageLabel();
            } catch (e) {
              console.warn("[Storage] 不要なファイルの削除に失敗しました", e);
              Alert.alert("削除に失敗しました");
            } finally {
              setIsDeletingOrphans(false);
            }
          },
        },
      ]
    );
  };

  const handleCreateBackup = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);
    try {
      const zipFile = await createBackupZip();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(zipFile.uri, {
          mimeType: "application/zip",
          dialogTitle: zipFile.name,
        });
      } else {
        Alert.alert("保存しました", zipFile.uri);
      }
    } catch (e) {
      console.warn("[Backup] バックアップの作成に失敗しました", e);
      Alert.alert("バックアップの作成に失敗しました");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (isBackingUp || isRestoring) return;

    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const zipUri = result.assets[0]?.uri;
    if (!zipUri) return;

    let extractDir: Directory;
    setIsRestoring(true);
    try {
      extractDir = await extractAndValidateBackup(zipUri);
    } catch (e) {
      setIsRestoring(false);
      if (e instanceof InvalidBackupError) {
        Alert.alert("バックアップファイルが正しくありません");
      } else {
        console.warn("[Restore] バックアップの検証に失敗しました", e);
        Alert.alert("バックアップファイルが正しくありません");
      }
      return;
    }

    Alert.alert(
      "バックアップを復元しますか？",
      "バックアップを復元すると、現在のデータは全て上書きされます。よろしいですか？",
      [
        {
          text: "キャンセル",
          style: "cancel",
          onPress: () => {
            discardExtractedBackup(extractDir);
            setIsRestoring(false);
          },
        },
        {
          text: "復元",
          style: "destructive",
          onPress: async () => {
            try {
              await applyBackup(extractDir);
              refreshTotalStorageLabel();
              Alert.alert(
                "復元が完了しました",
                "変更を反映するため、アプリを再起動してください。"
              );
            } catch (e) {
              console.warn("[Restore] 復元に失敗しました", e);
              if (e instanceof RestoreRollbackFailedError) {
                Alert.alert(
                  "復元に失敗しました",
                  "復元に失敗し、データの状態が不安定になっている可能性があります。バックアップから再度復元をお試しいただくか、お手数ですがサポートにご連絡ください。"
                );
              } else {
                Alert.alert("復元に失敗しました", "元のデータは保持されています。");
              }
            } finally {
              setIsRestoring(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleSectionGrouping = (value: boolean) => {
    setSectionGroupingEnabledState(value);
    setSectionGroupingEnabled(value);
  };

  const handleSelectDefaultSectionGap = (ms: number) => {
    setDefaultSectionGapMsState(ms);
    setDefaultSectionGapMs(ms);
  };

  const applyPlaybackLeadSec = useCallback((value: number) => {
    const clamped = Math.min(
      PLAYBACK_LEAD_MAX_SEC,
      Math.max(PLAYBACK_LEAD_MIN_SEC, Math.round(value * 10) / 10)
    );
    playbackLeadSecRef.current = clamped;
    setPlaybackLeadSecState(clamped);
    setPlaybackLeadSec(clamped);
  }, []);

  const handleChangePlaybackLead = useCallback(
    (delta: number) => {
      applyPlaybackLeadSec(playbackLeadSecRef.current + delta);
    },
    [applyPlaybackLeadSec]
  );

  const handleResetPlaybackLead = useCallback(() => {
    stopLeadRepeat();
    applyPlaybackLeadSec(PLAYBACK_LEAD_DEFAULT_SEC);
  }, [applyPlaybackLeadSec, stopLeadRepeat]);

  // 長押し中は最初の変更の後、少し待ってから一定間隔で変更を繰り返す
  const startLeadRepeat = useCallback(
    (delta: number) => {
      stopLeadRepeat();
      handleChangePlaybackLead(delta);
      leadRepeatTimeoutRef.current = setTimeout(() => {
        leadRepeatIntervalRef.current = setInterval(() => handleChangePlaybackLead(delta), 120);
      }, 400);
    },
    [handleChangePlaybackLead, stopLeadRepeat]
  );

  const handleSelectSampleRate = (hz: number) => {
    setRecordingSampleRateState(hz);
    setRecordingSampleRate(hz);
  };

  const handleToggleAllowBluetoothMic = (value: boolean) => {
    setAllowBluetoothMicState(value);
    setAllowBluetoothMic(value);
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
          <Text style={styles.sectionHeader}>再生</Text>
          <View style={styles.card}>
            <View style={styles.leadRow}>
              <View style={styles.leadRowHeader}>
                <Ionicons name="play-outline" size={20} color="#06c" style={styles.rowIcon} />
                <Text style={styles.rowLabel}>再生開始位置(lead)</Text>
              </View>
              <View style={styles.leadStepperRow}>
                <TouchableOpacity
                  style={styles.leadStepperButton}
                  disabled={playbackLeadSec <= PLAYBACK_LEAD_MIN_SEC}
                  onPressIn={() => startLeadRepeat(-PLAYBACK_LEAD_STEP_SEC)}
                  onPressOut={stopLeadRepeat}
                >
                  <Ionicons name="remove" size={18} color="#06c" />
                </TouchableOpacity>
                <Text style={styles.leadStepperValue}>{playbackLeadSec.toFixed(1)}秒</Text>
                <TouchableOpacity
                  style={styles.leadStepperButton}
                  disabled={playbackLeadSec >= PLAYBACK_LEAD_MAX_SEC}
                  onPressIn={() => startLeadRepeat(PLAYBACK_LEAD_STEP_SEC)}
                  onPressOut={stopLeadRepeat}
                >
                  <Ionicons name="add" size={18} color="#06c" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.leadResetButton}
                  disabled={playbackLeadSec === PLAYBACK_LEAD_DEFAULT_SEC}
                  onPress={handleResetPlaybackLead}
                >
                  <Ionicons
                    name="refresh-outline"
                    size={14}
                    color={playbackLeadSec === PLAYBACK_LEAD_DEFAULT_SEC ? "#c7c7cc" : "#06c"}
                  />
                  <Text
                    style={[
                      styles.leadResetButtonText,
                      playbackLeadSec === PLAYBACK_LEAD_DEFAULT_SEC && styles.leadResetButtonTextDisabled,
                    ]}
                  >
                    リセット
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.gapHint}>
                タップ再生時に、何秒手前から再生を開始するかの設定です。ボタンを押し続けると連続して変更できます。
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>録音</Text>
          <View style={styles.card}>
            <View style={[styles.gapRow, styles.rowDivider]}>
              <View style={styles.leadRowHeader}>
                <Ionicons name="mic-outline" size={20} color="#06c" style={styles.rowIcon} />
                <Text style={styles.rowLabel}>音声の品質 / サンプルレート</Text>
              </View>
              <View style={styles.gapOptionRow}>
                {SAMPLE_RATE_OPTIONS.map((opt) => {
                  const selected = opt.hz === recordingSampleRate;
                  return (
                    <TouchableOpacity
                      key={opt.hz}
                      style={[styles.gapOption, selected && styles.gapOptionSelected]}
                      onPress={() => handleSelectSampleRate(opt.hz)}
                    >
                      <Text style={[styles.gapOptionText, selected && styles.gapOptionTextSelected]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.gapHint}>
                {SAMPLE_RATE_OPTIONS.find((opt) => opt.hz === recordingSampleRate)?.hint}
              </Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="bluetooth-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>外部マイクを使う</Text>
              <Switch value={allowBluetoothMic} onValueChange={handleToggleAllowBluetoothMic} />
            </View>
            <Text style={styles.bluetoothHint}>
              オンにすると、接続中のワイヤレスイヤホンやピンマイクから録音します。離れた場所の声を録る場合はオフのままにしてください。
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ストレージ管理</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.row, styles.rowDivider]}
              onPress={() => navigation.navigate("StorageManagement")}
            >
              <Ionicons name="server-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>ストレージ管理</Text>
              <Text style={styles.rowValue}>{totalStorageLabel}</Text>
              <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.row}
              disabled={isCheckingOrphans || isDeletingOrphans}
              onPress={handleDeleteOrphanFiles}
            >
              <Ionicons name="trash-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>
                {isDeletingOrphans
                  ? "削除中…"
                  : isCheckingOrphans
                  ? "確認中…"
                  : "不要なファイルを削除"}
              </Text>
              {isCheckingOrphans || isDeletingOrphans ? (
                <ActivityIndicator size="small" color="#06c" />
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>バックアップ</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.row, styles.rowDivider]}
              disabled={isBackingUp || isRestoring}
              onPress={handleCreateBackup}
            >
              <Ionicons name="share-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>
                {isBackingUp ? "バックアップを作成中…" : "バックアップを作成"}
              </Text>
              {isBackingUp ? <ActivityIndicator size="small" color="#06c" /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.row}
              disabled={isBackingUp || isRestoring}
              onPress={handleRestoreBackup}
            >
              <Ionicons name="cloud-upload-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>
                {isRestoring ? "復元中…" : "バックアップから復元"}
              </Text>
              {isRestoring ? <ActivityIndicator size="small" color="#06c" /> : null}
            </TouchableOpacity>
          </View>
        </View>

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
            <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("HowToUse", { section: "settings" })}>
              <Ionicons name="help-circle-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>使い方</Text>
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
  title: { fontSize: fontSize.tabTitle, fontWeight: "700", marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
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
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.cardPadding,
    paddingHorizontal: spacing.cardPadding,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
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
  leadRow: { paddingVertical: 12, paddingHorizontal: 12, gap: 10 },
  leadRowHeader: { flexDirection: "row", alignItems: "center" },
  leadStepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
  leadStepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f2f2f7",
    alignItems: "center",
    justifyContent: "center",
  },
  leadStepperValue: { fontSize: 18, fontWeight: "600", minWidth: 60, textAlign: "center" },
  leadResetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "#f2f2f7",
  },
  leadResetButtonText: { fontSize: 13, fontWeight: "600", color: "#06c" },
  leadResetButtonTextDisabled: { color: "#c7c7cc" },
  bluetoothHint: {
    fontSize: 12,
    color: "#8e8e93",
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
});
