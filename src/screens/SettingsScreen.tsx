import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Directory } from "expo-file-system";
import { seedDevTestData } from "../utils/devTestData";
import type { RootStackParamList } from "../navigation/RootNavigator";
import {
  PARAGRAPH_GAP_FACTORY_DEFAULT_MS,
  PARAGRAPH_GAP_MIN_MS,
  PARAGRAPH_GAP_STEP_MS,
  PLAYBACK_LEAD_DEFAULT_SEC,
  PLAYBACK_LEAD_MAX_SEC,
  PLAYBACK_LEAD_MIN_SEC,
  PLAYBACK_LEAD_STEP_SEC,
  SAMPLE_RATE_OPTIONS,
  SECTION_GAP_FACTORY_DEFAULT_MS,
  SECTION_GAP_MAX_MS,
  SECTION_GAP_MIN_MS,
  SECTION_GAP_STEP_MS,
  SPEECH_RECOGNITION_LANGUAGE_OPTIONS,
  type LanguagePreference,
  getAllowBluetoothMic,
  getDefaultParagraphGapMs,
  getDefaultSectionGapMs,
  getLanguagePreference,
  getPlaybackLeadSec,
  getRecordingSampleRate,
  getSectionGroupingEnabled,
  getSpeechRecognitionLanguage,
  paragraphGapMaxMs,
  setAllowBluetoothMic,
  setDefaultParagraphGapMs,
  setDefaultSectionGapMs,
  setLanguagePreference,
  setPlaybackLeadSec,
  setRecordingSampleRate,
  setSectionGroupingEnabled,
  setSpeechRecognitionLanguage,
} from "../utils/settings";
import { applyLanguagePreference } from "../i18n";
import { getIsRecordingActive } from "../utils/recordingStatus";
import GapSlider from "../components/GapSlider";
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

type Row = { icon: keyof typeof Ionicons.glyphMap; labelKey: string; value?: string };
type Section = { titleKey: string; rows: Row[] };

const SECTIONS: Section[] = [
  {
    titleKey: "settings.appInfo.sectionHeader",
    rows: [
      { icon: "document-text-outline", labelKey: "settings.appInfo.terms" },
      { icon: "shield-checkmark-outline", labelKey: "settings.appInfo.privacyPolicy" },
      { icon: "code-slash-outline", labelKey: "settings.appInfo.openSourceLicenses" },
      { icon: "mail-outline", labelKey: "settings.appInfo.contact" },
    ],
  },
];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [isSeeding, setIsSeeding] = useState(false);
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(getLanguagePreference);
  const [speechRecognitionLanguage, setSpeechRecognitionLanguageState] = useState(getSpeechRecognitionLanguage);
  const [sectionGroupingEnabled, setSectionGroupingEnabledState] = useState(getSectionGroupingEnabled);
  const [defaultSectionGapMs, setDefaultSectionGapMsState] = useState(getDefaultSectionGapMs);
  const [defaultParagraphGapMs, setDefaultParagraphGapMsState] = useState(getDefaultParagraphGapMs);
  // GapSliderは画面全体のScrollView内に置いているため、ドラッグ中はスクロールに
  // 操作を取られないよう一時的にスクロールを無効化する
  const [isGapSliderDragging, setIsGapSliderDragging] = useState(false);
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
      Alert.alert(t("settings.storage.checkFailed"));
      return;
    } finally {
      setIsCheckingOrphans(false);
    }

    const count = summary.audioUris.length + summary.photoUris.length;
    if (count === 0) {
      Alert.alert(t("settings.storage.noOrphans"));
      return;
    }

    Alert.alert(
      t("settings.storage.deleteConfirm.title"),
      t("settings.storage.deleteConfirm.message", { count, size: formatBytes(summary.bytes) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setIsDeletingOrphans(true);
            try {
              await deleteOrphanFiles(summary);
              refreshTotalStorageLabel();
            } catch (e) {
              console.warn("[Storage] 不要なファイルの削除に失敗しました", e);
              Alert.alert(t("settings.storage.deleteFailed"));
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
        Alert.alert(t("settings.backup.savedTitle"), zipFile.uri);
      }
    } catch (e) {
      console.warn("[Backup] バックアップの作成に失敗しました", e);
      Alert.alert(t("settings.backup.createFailed"));
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
        Alert.alert(t("settings.backup.invalidFile"));
      } else {
        console.warn("[Restore] バックアップの検証に失敗しました", e);
        Alert.alert(t("settings.backup.invalidFile"));
      }
      return;
    }

    Alert.alert(
      t("settings.backup.restoreConfirm.title"),
      t("settings.backup.restoreConfirm.message"),
      [
        {
          text: t("common.cancel"),
          style: "cancel",
          onPress: () => {
            discardExtractedBackup(extractDir);
            setIsRestoring(false);
          },
        },
        {
          text: t("settings.backup.restoreButton"),
          style: "destructive",
          onPress: async () => {
            try {
              await applyBackup(extractDir);
              refreshTotalStorageLabel();
              Alert.alert(
                t("settings.backup.restoreDone.title"),
                t("settings.backup.restoreDone.message")
              );
            } catch (e) {
              console.warn("[Restore] 復元に失敗しました", e);
              if (e instanceof RestoreRollbackFailedError) {
                Alert.alert(
                  t("settings.backup.restoreFailedTitle"),
                  t("settings.backup.restoreFailed.rollbackMessage")
                );
              } else {
                Alert.alert(t("settings.backup.restoreFailedTitle"), t("settings.backup.restoreFailed.keptMessage"));
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

  // スライダーのドラッグ中は毎フレームstateを直接更新して即座に表示へ反映し、指を離した時にだけ
  // 保存する(NoteDetailScreenのGapSliderと同じ考え方)。セクション側を縮めて改行側の値が
  // 新しい上限を超えた場合は、setDefaultSectionGapMs内で改行側もクランプ・保存されるため、
  // ここではローカルstateをその結果に合わせるだけでよい
  const handleSelectDefaultSectionGap = (ms: number) => {
    setDefaultSectionGapMsState(ms);
  };

  const handleDefaultSectionGapChangeComplete = (ms: number) => {
    setDefaultSectionGapMsState(ms);
    setDefaultSectionGapMs(ms);
    setDefaultParagraphGapMsState((prev) => paragraphGapMaxMs(ms) < prev ? paragraphGapMaxMs(ms) : prev);
  };

  const handleSelectDefaultParagraphGap = (ms: number) => {
    setDefaultParagraphGapMsState(ms);
  };

  const handleDefaultParagraphGapChangeComplete = (ms: number) => {
    setDefaultParagraphGapMsState(ms);
    setDefaultParagraphGapMs(ms);
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

  const languagePreferenceLabel = (pref: LanguagePreference) =>
    pref === "system"
      ? t("settings.language.system")
      : pref === "ja"
      ? t("settings.language.japanese")
      : t("settings.language.english");

  const handleChangeLanguagePreference = (pref: LanguagePreference) => {
    setLanguagePreferenceState(pref);
    setLanguagePreference(pref);
    applyLanguagePreference(pref);
  };

  const handlePressLanguageRow = () => {
    Alert.alert(t("settings.language.promptTitle"), undefined, [
      { text: t("settings.language.system"), onPress: () => handleChangeLanguagePreference("system") },
      { text: t("settings.language.japanese"), onPress: () => handleChangeLanguagePreference("ja") },
      { text: t("settings.language.english"), onPress: () => handleChangeLanguagePreference("en") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const speechRecognitionLanguageLabel = (code: string) => {
    const option = SPEECH_RECOGNITION_LANGUAGE_OPTIONS.find((opt) => opt.code === code);
    return option ? t(option.labelKey) : code;
  };

  const handleChangeSpeechRecognitionLanguage = (code: string) => {
    setSpeechRecognitionLanguageState(code);
    setSpeechRecognitionLanguage(code);
  };

  // 録音中(一時停止していない)に変更する場合は、現在のセッションが一瞬再起動される旨を
  // 確認してから反映する。待機中・一時停止中はそのまま変更してよい
  const confirmSpeechRecognitionLanguageChange = (code: string) => {
    if (code === speechRecognitionLanguage) return;
    if (!getIsRecordingActive()) {
      handleChangeSpeechRecognitionLanguage(code);
      return;
    }
    Alert.alert(
      t("settings.speechLanguage.restartConfirm.title"),
      t("settings.speechLanguage.restartConfirm.message"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.speechLanguage.restartConfirm.confirm"),
          onPress: () => handleChangeSpeechRecognitionLanguage(code),
        },
      ]
    );
  };

  const handlePressSpeechLanguageRow = () => {
    Alert.alert(t("settings.speechLanguage.promptTitle"), undefined, [
      ...SPEECH_RECOGNITION_LANGUAGE_OPTIONS.map((opt) => ({
        text: t(opt.labelKey),
        onPress: () => confirmSpeechRecognitionLanguageChange(opt.code),
      })),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  };

  const handleSeedTestData = async () => {
    if (isSeeding) return;
    setIsSeeding(true);
    try {
      await seedDevTestData();
      Alert.alert(t("settings.dev.seedDone"));
    } catch (e) {
      console.warn("[Dev] テストデータの投入に失敗しました", e);
      Alert.alert(t("settings.dev.seedFailed"));
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!isGapSliderDragging}>
        <Text style={styles.title}>{t("settings.title")}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.playback.sectionHeader")}</Text>
          <View style={styles.card}>
            <View style={styles.leadRow}>
              <View style={styles.leadRowHeader}>
                <Ionicons name="play-outline" size={20} color="#06c" style={styles.rowIcon} />
                <Text style={styles.rowLabel}>{t("settings.playback.leadRowLabel")}</Text>
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
                <Text style={styles.leadStepperValue}>
                  {t("settings.playback.leadValue", { sec: playbackLeadSec.toFixed(1) })}
                </Text>
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
                    {t("settings.playback.resetButton")}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.gapHint}>{t("settings.playback.leadHint")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.recording.sectionHeader")}</Text>
          <View style={styles.card}>
            <View style={[styles.gapRow, styles.rowDivider]}>
              <View style={styles.leadRowHeader}>
                <Ionicons name="mic-outline" size={20} color="#06c" style={styles.rowIcon} />
                <Text style={styles.rowLabel}>{t("settings.recording.sampleRateLabel")}</Text>
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
                        {t(opt.labelKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.gapHint}>
                {t(SAMPLE_RATE_OPTIONS.find((opt) => opt.hz === recordingSampleRate)?.hintKey ?? "")}
              </Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="bluetooth-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t("settings.recording.bluetoothLabel")}</Text>
              <Switch value={allowBluetoothMic} onValueChange={handleToggleAllowBluetoothMic} />
            </View>
            <Text style={styles.bluetoothHint}>{t("settings.recording.bluetoothHint")}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.timeline.sectionHeader")}</Text>
          <View style={styles.card}>
            <View style={[styles.row, styles.rowDivider]}>
              <Ionicons name="layers-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t("noteDetail.settingsSheet.sectionGroupingLabel")}</Text>
              <Switch value={sectionGroupingEnabled} onValueChange={handleToggleSectionGrouping} />
            </View>
            <View style={styles.gapRow}>
              <Text style={styles.rowLabel}>{t("settings.timeline.defaultGapLabel")}</Text>
              <GapSlider
                valueMs={defaultSectionGapMs}
                minMs={SECTION_GAP_MIN_MS}
                maxMs={SECTION_GAP_MAX_MS}
                stepMs={SECTION_GAP_STEP_MS}
                label={t("gapSlider.sectionLabel", { sec: (defaultSectionGapMs / 1000).toFixed(1) })}
                fineLabel={t("gapSlider.fine")}
                coarseLabel={t("gapSlider.coarse")}
                defaultValueMs={SECTION_GAP_FACTORY_DEFAULT_MS}
                onChange={handleSelectDefaultSectionGap}
                onChangeComplete={handleDefaultSectionGapChangeComplete}
                onDragStart={() => setIsGapSliderDragging(true)}
                onDragEnd={() => setIsGapSliderDragging(false)}
              />
              <Text style={styles.gapHint}>{t("settings.timeline.defaultGapHint")}</Text>
            </View>
            <View style={styles.gapRow}>
              <Text style={styles.rowLabel}>{t("settings.timeline.defaultParagraphGapLabel")}</Text>
              <GapSlider
                valueMs={defaultParagraphGapMs}
                minMs={PARAGRAPH_GAP_MIN_MS}
                maxMs={paragraphGapMaxMs(defaultSectionGapMs)}
                stepMs={PARAGRAPH_GAP_STEP_MS}
                label={t("gapSlider.paragraphLabel", { sec: (defaultParagraphGapMs / 1000).toFixed(1) })}
                fineLabel={t("gapSlider.fine")}
                coarseLabel={t("gapSlider.coarse")}
                defaultValueMs={PARAGRAPH_GAP_FACTORY_DEFAULT_MS}
                onChange={handleSelectDefaultParagraphGap}
                onChangeComplete={handleDefaultParagraphGapChangeComplete}
                onDragStart={() => setIsGapSliderDragging(true)}
                onDragEnd={() => setIsGapSliderDragging(false)}
              />
              <Text style={styles.gapHint}>{t("settings.timeline.defaultParagraphGapHint")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.storage.sectionHeader")}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.row, styles.rowDivider]}
              onPress={() => navigation.navigate("StorageManagement")}
            >
              <Ionicons name="server-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t("navigation.storageManagementTitle")}</Text>
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
                  ? t("settings.storage.deleting")
                  : isCheckingOrphans
                  ? t("settings.storage.checking")
                  : t("settings.storage.deleteOrphans")}
              </Text>
              {isCheckingOrphans || isDeletingOrphans ? (
                <ActivityIndicator size="small" color="#06c" />
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.backup.sectionHeader")}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.row, styles.rowDivider]}
              disabled={isBackingUp || isRestoring}
              onPress={handleCreateBackup}
            >
              <Ionicons name="share-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>
                {isBackingUp ? t("settings.backup.creating") : t("settings.backup.create")}
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
                {isRestoring ? t("settings.backup.restoring") : t("settings.backup.restoreFromBackup")}
              </Text>
              {isRestoring ? <ActivityIndicator size="small" color="#06c" /> : null}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.help.sectionHeader")}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("HowToUse", { section: "settings" })}>
              <Ionicons name="help-circle-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t("navigation.howToUseTitle")}</Text>
              <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{t("settings.languageSection.sectionHeader")}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={[styles.row, styles.rowDivider]} onPress={handlePressLanguageRow}>
              <Ionicons name="language-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t("settings.language.rowLabel")}</Text>
              <Text style={styles.rowValue}>{languagePreferenceLabel(languagePreference)}</Text>
              <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.row} onPress={handlePressSpeechLanguageRow}>
              <Ionicons name="mic-circle-outline" size={20} color="#06c" style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t("settings.speechLanguage.rowLabel")}</Text>
              <Text style={styles.rowValue}>{speechRecognitionLanguageLabel(speechRecognitionLanguage)}</Text>
              <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            </TouchableOpacity>
            <Text style={styles.bluetoothHint}>{t("settings.speechLanguage.hint")}</Text>
          </View>
        </View>

        {SECTIONS.map((section) => (
          <View key={section.titleKey} style={styles.section}>
            <Text style={styles.sectionHeader}>{t(section.titleKey)}</Text>
            <View style={styles.card}>
              {section.rows.map((row, i) => (
                <TouchableOpacity
                  key={row.labelKey}
                  style={[
                    styles.row,
                    i < section.rows.length - 1 && styles.rowDivider,
                  ]}
                >
                  <Ionicons name={row.icon} size={20} color="#06c" style={styles.rowIcon} />
                  <Text style={styles.rowLabel}>{t(row.labelKey)}</Text>
                  {row.value ? <Text style={styles.rowValue}>{row.value}</Text> : null}
                  <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {__DEV__ ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{t("settings.dev.sectionHeader")}</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                disabled={isSeeding}
                onPress={handleSeedTestData}
              >
                <Ionicons name="flask-outline" size={20} color="#06c" style={styles.rowIcon} />
                <Text style={styles.rowLabel}>
                  {isSeeding ? t("settings.dev.seeding") : t("settings.dev.seedButton")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* バックアップ作成・復元は途中でデータ変更や画面遷移が起きると整合性が崩れうるため、
          処理中は画面全体を覆って一切操作できないようにする(スピナー表示だけでは不十分) */}
      <Modal visible={isBackingUp || isRestoring} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.blockingOverlay}>
          <View style={styles.blockingCard}>
            <ActivityIndicator size="large" color="#06c" />
            <Text style={styles.blockingText}>
              {isRestoring ? t("settings.backup.restoring") : t("settings.backup.creating")}
            </Text>
          </View>
        </View>
      </Modal>
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
  // バックアップ作成・復元中に画面全体を覆う操作不可オーバーレイ
  blockingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  blockingCard: {
    backgroundColor: "#fff",
    borderRadius: radius.card,
    paddingVertical: 28,
    paddingHorizontal: 36,
    alignItems: "center",
    gap: 14,
  },
  blockingText: { fontSize: 15, color: "#1c1c1e", fontWeight: "600" },
});
