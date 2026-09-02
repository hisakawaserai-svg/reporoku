import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { Trans, useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as colors from "../theme/colors";
import { radius, spacing } from "../theme/spacing";
import { fontSize } from "../theme/typography";

type TabId = "record" | "noteDetail" | "summary" | "notesList" | "settings";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

function InlineIcon({ name, color }: { name: IconName; color: string }) {
  return <Ionicons name={name} size={15} color={color} style={styles.inlineIcon} />;
}

function RecordIntro() {
  return (
    <Text style={styles.sectionBody}>
      <Trans
        i18nKey="howToUse.record.intro"
        components={{
          star: <InlineIcon name="star" color={colors.star.accent} />,
          check: <InlineIcon name="checkmark-circle" color={colors.todo.accent} />,
          question: <InlineIcon name="help-circle" color={colors.question.accent} />,
          camera: <InlineIcon name="camera" color="#57575c" />,
          pencil: <InlineIcon name="create" color="#57575c" />,
        }}
      />
    </Text>
  );
}

function NoteDetailIntro() {
  return (
    <Text style={styles.sectionBody}>
      <Trans
        i18nKey="howToUse.noteDetail.intro"
        components={{
          star: <InlineIcon name="star" color={colors.star.accent} />,
          question: <InlineIcon name="help-circle" color={colors.question.accent} />,
        }}
      />
    </Text>
  );
}

function SummaryIntro() {
  const { t } = useTranslation();
  return <Text style={styles.sectionBody}>{t("howToUse.summary.intro")}</Text>;
}

function NotesListIntro() {
  const { t } = useTranslation();
  return <Text style={styles.sectionBody}>{t("howToUse.notesList.intro")}</Text>;
}

function SettingsIntro() {
  const { t } = useTranslation();
  return <Text style={styles.sectionBody}>{t("howToUse.settings.intro")}</Text>;
}

function RecordDiagram() {
  const { t } = useTranslation();
  const tiles: { icon: IconName; color: string; bg: string }[] = [
    { icon: "star", color: colors.star.accent, bg: colors.star.background },
    { icon: "checkmark-circle", color: colors.todo.accent, bg: colors.todo.background },
    { icon: "help-circle", color: colors.question.accent, bg: colors.question.background },
  ];
  return (
    <View style={styles.diagramBox}>
      <View style={styles.diagramRow}>
        {tiles.map((t) => (
          <View key={t.icon} style={[styles.diagramTile, { backgroundColor: t.bg }]}>
            <Ionicons name={t.icon} size={22} color={t.color} />
          </View>
        ))}
        <View style={styles.diagramSpacer} />
        <View style={[styles.diagramTile, styles.diagramTileMuted]}>
          <Ionicons name="camera" size={20} color="#57575c" />
        </View>
        <View style={[styles.diagramTile, styles.diagramTileMuted]}>
          <Ionicons name="create" size={20} color="#57575c" />
        </View>
      </View>
      <View style={styles.diagramTapRow}>
        <Ionicons name="arrow-up" size={14} color={colors.primary} />
        <Text style={styles.diagramTapLabel}>{t("howToUse.record.diagramTapLabel")}</Text>
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="time-outline" size={16} color="#8e8e93" />
        <Text style={styles.diagramCaption}>{t("howToUse.record.diagramLongPressCaption")}</Text>
      </View>
    </View>
  );
}

function NoteDetailDiagram() {
  const { t } = useTranslation();
  return (
    <View style={styles.diagramBox}>
      <View style={styles.diagramFakeRow}>
        <View style={styles.diagramFakeRowText}>
          <View style={styles.diagramFakeLine} />
          <View style={[styles.diagramFakeLine, { width: "60%" }]} />
        </View>
        <Ionicons name="play-circle-outline" size={20} color={colors.primary} />
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="arrow-forward" size={14} color={colors.primary} />
        <Text style={styles.diagramCaption}>{t("howToUse.noteDetail.diagramTapCaption")}</Text>
      </View>

      <View style={[styles.diagramFakeRow, { marginTop: 12 }]}>
        <View style={styles.diagramFakeRowText}>
          <View style={styles.diagramFakeLine} />
          <View style={[styles.diagramFakeLine, { width: "40%" }]} />
        </View>
        <Ionicons name="create-outline" size={18} color="#8e8e93" />
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="time-outline" size={16} color="#8e8e93" />
        <Text style={styles.diagramCaption}>{t("howToUse.noteDetail.diagramLongPressCaption")}</Text>
      </View>

      <View style={styles.diagramFilterRow}>
        <View style={[styles.diagramPill, { backgroundColor: colors.star.background }]}>
          <Ionicons name="star" size={13} color={colors.star.accent} />
        </View>
        <View style={[styles.diagramPill, { backgroundColor: colors.question.background }]}>
          <Ionicons name="help-circle" size={13} color={colors.question.accent} />
        </View>
        <Text style={styles.diagramCaption}>{t("howToUse.noteDetail.diagramFilterCaption")}</Text>
      </View>
    </View>
  );
}

function SummaryDiagram() {
  const { t } = useTranslation();
  return (
    <View style={styles.diagramBox}>
      <View style={styles.diagramConvergeRow}>
        {[0, 1, 2].map((i) => (
          <Ionicons key={i} name="document-text-outline" size={18} color="#8e8e93" />
        ))}
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="arrow-down" size={14} color={colors.primary} />
        <Text style={styles.diagramCaption}>{t("howToUse.summary.diagramConvergeCaption")}</Text>
      </View>
      <View style={styles.diagramRow}>
        <View style={[styles.diagramPillWide, { backgroundColor: colors.todo.background }]}>
          <Ionicons name="checkmark-circle" size={14} color={colors.todo.accent} />
          <Text style={[styles.diagramPillText, { color: colors.todo.accent }]}>
            {t("howToUse.summary.diagramPendingTodo")}
          </Text>
        </View>
        <View style={[styles.diagramPillWide, { backgroundColor: colors.question.background }]}>
          <Ionicons name="help-circle" size={14} color={colors.question.accent} />
          <Text style={[styles.diagramPillText, { color: colors.question.accent }]}>
            {t("howToUse.summary.diagramUnresolvedQuestion")}
          </Text>
        </View>
      </View>
      <View style={styles.diagramRow}>
        <View style={[styles.diagramPillWide, { backgroundColor: colors.star.background }]}>
          <Ionicons name="star" size={14} color={colors.star.accent} />
          <Text style={[styles.diagramPillText, { color: colors.star.accent }]}>
            {t("howToUse.summary.diagramImportant")}
          </Text>
        </View>
      </View>
    </View>
  );
}

function NotesListDiagram() {
  const { t } = useTranslation();
  return (
    <View style={styles.diagramBox}>
      <View style={styles.diagramRow}>
        <View style={styles.diagramSegment}>
          <Ionicons name="list-outline" size={16} color={colors.primary} />
          <Text style={styles.diagramSegmentText}>{t("notes.mode.list")}</Text>
        </View>
        <View style={[styles.diagramSegment, styles.diagramSegmentMuted]}>
          <Ionicons name="calendar-outline" size={16} color="#8e8e93" />
          <Text style={[styles.diagramSegmentText, { color: "#8e8e93" }]}>{t("notes.mode.calendar")}</Text>
        </View>
      </View>
      <View style={styles.diagramSearchRow}>
        <Ionicons name="search" size={16} color="#8e8e93" />
        <Text style={styles.diagramSearchText}>{t("howToUse.notesList.diagramSearchPlaceholder")}</Text>
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="information-circle-outline" size={16} color="#8e8e93" />
        <Text style={styles.diagramCaption}>{t("howToUse.notesList.diagramSearchHint")}</Text>
      </View>
    </View>
  );
}

function SettingsDiagram() {
  const { t } = useTranslation();
  const rows: { icon: IconName; labelKey: string }[] = [
    { icon: "play-skip-back-outline", labelKey: "howToUse.settings.diagramLeadTime" },
    { icon: "musical-notes-outline", labelKey: "howToUse.settings.diagramSampleRate" },
    { icon: "bluetooth-outline", labelKey: "howToUse.settings.diagramExternalMic" },
    { icon: "archive-outline", labelKey: "settings.backup.sectionHeader" },
  ];
  return (
    <View style={styles.diagramBox}>
      {rows.map((r) => (
        <View key={r.icon} style={styles.diagramSettingsRow}>
          <View style={styles.diagramSettingsIcon}>
            <Ionicons name={r.icon} size={16} color={colors.primary} />
          </View>
          <Text style={styles.diagramSettingsLabel}>{t(r.labelKey)}</Text>
          <Ionicons name="chevron-forward" size={14} color="#c7c7cc" />
        </View>
      ))}
    </View>
  );
}

type Subsection = {
  headingKey: string;
  icon: IconName;
  bulletKeys: string[];
};

const RECORD_SUBSECTIONS: Subsection[] = [
  {
    headingKey: "howToUse.record.sections.pauseVsEnd.heading",
    icon: "pause-circle-outline",
    bulletKeys: [
      "howToUse.record.sections.pauseVsEnd.bullet1",
      "howToUse.record.sections.pauseVsEnd.bullet2",
    ],
  },
  {
    headingKey: "howToUse.record.sections.multipleMarks.heading",
    icon: "pricetags-outline",
    bulletKeys: [
      "howToUse.record.sections.multipleMarks.bullet1",
      "howToUse.record.sections.multipleMarks.bullet2",
    ],
  },
  {
    headingKey: "howToUse.record.sections.autoScroll.heading",
    icon: "arrow-down-circle-outline",
    bulletKeys: [
      "howToUse.record.sections.autoScroll.bullet1",
      "howToUse.record.sections.autoScroll.bullet2",
    ],
  },
  {
    headingKey: "howToUse.record.sections.sectionGrouping.heading",
    icon: "reader-outline",
    bulletKeys: [
      "howToUse.record.sections.sectionGrouping.bullet1",
      "howToUse.record.sections.sectionGrouping.bullet2",
    ],
  },
  {
    headingKey: "howToUse.record.sections.interruptedRecording.heading",
    icon: "warning-outline",
    bulletKeys: [
      "howToUse.record.sections.interruptedRecording.bullet1",
      "howToUse.record.sections.interruptedRecording.bullet2",
    ],
  },
  {
    headingKey: "howToUse.record.sections.sleepMode.heading",
    icon: "moon-outline",
    bulletKeys: [
      "howToUse.record.sections.sleepMode.bullet1",
      "howToUse.record.sections.sleepMode.bullet2",
      "howToUse.record.sections.sleepMode.bullet3",
    ],
  },
  {
    headingKey: "howToUse.record.sections.resetButton.heading",
    icon: "refresh-outline",
    bulletKeys: [
      "howToUse.record.sections.resetButton.bullet1",
      "howToUse.record.sections.resetButton.bullet2",
    ],
  },
  {
    headingKey: "howToUse.record.sections.audioInterference.heading",
    icon: "volume-mute-outline",
    bulletKeys: ["howToUse.record.sections.audioInterference.bullet1"],
  },
];

const NOTE_DETAIL_SUBSECTIONS: Subsection[] = [
  {
    headingKey: "howToUse.noteDetail.sections.longPressMenu.heading",
    icon: "hand-left-outline",
    bulletKeys: [
      "howToUse.noteDetail.sections.longPressMenu.bullet1",
      "howToUse.noteDetail.sections.longPressMenu.bullet2",
    ],
  },
  {
    headingKey: "howToUse.noteDetail.sections.mergeSplit.heading",
    icon: "git-merge-outline",
    bulletKeys: [
      "howToUse.noteDetail.sections.mergeSplit.bullet1",
      "howToUse.noteDetail.sections.mergeSplit.bullet2",
      "howToUse.noteDetail.sections.mergeSplit.bullet3",
    ],
  },
  {
    headingKey: "howToUse.noteDetail.sections.summaryTab.heading",
    icon: "layers-outline",
    bulletKeys: ["howToUse.noteDetail.sections.summaryTab.bullet1"],
  },
  {
    headingKey: "howToUse.noteDetail.sections.noAudioNotice.heading",
    icon: "alert-circle-outline",
    bulletKeys: ["howToUse.noteDetail.sections.noAudioNotice.bullet1"],
  },
  {
    headingKey: "howToUse.noteDetail.sections.export.heading",
    icon: "download-outline",
    bulletKeys: [
      "howToUse.noteDetail.sections.export.bullet1",
      "howToUse.noteDetail.sections.export.bullet2",
      "howToUse.noteDetail.sections.export.bullet3",
    ],
  },
];

const SUMMARY_SUBSECTIONS: Subsection[] = [
  {
    headingKey: "howToUse.summary.sections.hiddenByDefault.heading",
    icon: "eye-off-outline",
    bulletKeys: [
      "howToUse.summary.sections.hiddenByDefault.bullet1",
      "howToUse.summary.sections.hiddenByDefault.bullet2",
    ],
  },
  {
    headingKey: "howToUse.summary.sections.deferQuestion.heading",
    icon: "time-outline",
    bulletKeys: ["howToUse.summary.sections.deferQuestion.bullet1"],
  },
  {
    headingKey: "howToUse.summary.sections.groupedStars.heading",
    icon: "albums-outline",
    bulletKeys: ["howToUse.summary.sections.groupedStars.bullet1"],
  },
  {
    headingKey: "howToUse.summary.sections.itemToNote.heading",
    icon: "open-outline",
    bulletKeys: [
      "howToUse.summary.sections.itemToNote.bullet1",
      "howToUse.summary.sections.itemToNote.bullet2",
    ],
  },
];

const NOTES_LIST_SUBSECTIONS: Subsection[] = [
  {
    headingKey: "howToUse.notesList.sections.bulkSelect.heading",
    icon: "checkbox-outline",
    bulletKeys: [
      "howToUse.notesList.sections.bulkSelect.bullet1",
      "howToUse.notesList.sections.bulkSelect.bullet2",
      "howToUse.notesList.sections.bulkSelect.bullet3",
    ],
  },
  {
    headingKey: "howToUse.notesList.sections.calendarView.heading",
    icon: "calendar-outline",
    bulletKeys: [
      "howToUse.notesList.sections.calendarView.bullet1",
      "howToUse.notesList.sections.calendarView.bullet2",
      "howToUse.notesList.sections.calendarView.bullet3",
    ],
  },
];

const SETTINGS_SUBSECTIONS: Subsection[] = [
  {
    headingKey: "howToUse.settings.sections.leadTime.heading",
    icon: "play-skip-back-outline",
    bulletKeys: ["howToUse.settings.sections.leadTime.bullet1"],
  },
  {
    headingKey: "howToUse.settings.sections.sampleRate.heading",
    icon: "musical-notes-outline",
    bulletKeys: [
      "howToUse.settings.sections.sampleRate.bullet1",
      "howToUse.settings.sections.sampleRate.bullet2",
    ],
  },
  {
    headingKey: "howToUse.settings.sections.bluetoothMic.heading",
    icon: "bluetooth-outline",
    bulletKeys: [
      "howToUse.settings.sections.bluetoothMic.bullet1",
      "howToUse.settings.sections.bluetoothMic.bullet2",
    ],
  },
  {
    headingKey: "howToUse.settings.sections.sectionGroupingSettings.heading",
    icon: "timer-outline",
    bulletKeys: [
      "howToUse.settings.sections.sectionGroupingSettings.bullet1",
      "howToUse.settings.sections.sectionGroupingSettings.bullet2",
    ],
  },
  {
    headingKey: "howToUse.settings.sections.storageManagement.heading",
    icon: "folder-outline",
    bulletKeys: [
      "howToUse.settings.sections.storageManagement.bullet1",
      "howToUse.settings.sections.storageManagement.bullet2",
      "howToUse.settings.sections.storageManagement.bullet3",
    ],
  },
  {
    headingKey: "howToUse.settings.sections.backupRestore.heading",
    icon: "archive-outline",
    bulletKeys: [
      "howToUse.settings.sections.backupRestore.bullet1",
      "howToUse.settings.sections.backupRestore.bullet2",
      "howToUse.settings.sections.backupRestore.bullet3",
    ],
  },
];

const TABS: {
  id: TabId;
  labelKey: string;
  screenName: string;
  titleKey: string;
  Intro: () => React.JSX.Element;
  Diagram?: () => React.JSX.Element;
  subsections: Subsection[];
}[] = [
  {
    id: "record",
    labelKey: "howToUse.tabs.record",
    screenName: "RecordScreen",
    titleKey: "howToUse.record.title",
    Intro: RecordIntro,
    Diagram: RecordDiagram,
    subsections: RECORD_SUBSECTIONS,
  },
  {
    id: "noteDetail",
    labelKey: "navigation.noteDetailTitle",
    screenName: "NoteDetailScreen",
    titleKey: "howToUse.noteDetail.title",
    Intro: NoteDetailIntro,
    Diagram: NoteDetailDiagram,
    subsections: NOTE_DETAIL_SUBSECTIONS,
  },
  {
    id: "summary",
    labelKey: "navigation.tabSummary",
    screenName: "SummaryScreen",
    titleKey: "howToUse.summary.title",
    Intro: SummaryIntro,
    Diagram: SummaryDiagram,
    subsections: SUMMARY_SUBSECTIONS,
  },
  {
    id: "notesList",
    labelKey: "howToUse.tabs.notesList",
    screenName: "NotesScreen",
    titleKey: "howToUse.notesList.title",
    Intro: NotesListIntro,
    Diagram: NotesListDiagram,
    subsections: NOTES_LIST_SUBSECTIONS,
  },
  {
    id: "settings",
    labelKey: "navigation.tabSettings",
    screenName: "SettingsScreen",
    titleKey: "howToUse.settings.title",
    Intro: SettingsIntro,
    Diagram: SettingsDiagram,
    subsections: SETTINGS_SUBSECTIONS,
  },
];

export default function HowToUseScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<RootStackParamList, "HowToUse">>();
  const [activeTab, setActiveTab] = useState<TabId>(route.params?.section ?? "record");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  const toggleSubsection = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tabItem) => (
          <Text
            key={tabItem.id}
            onPress={() => setActiveTab(tabItem.id)}
            style={[styles.tabChip, tabItem.id === activeTab && styles.tabChipSelected]}
          >
            {t(tabItem.labelKey)}
          </Text>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.content} key={tab.id}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(tab.titleKey)}</Text>
          {tab.Diagram ? (
            <>
              <View style={styles.diagramLabelRow}>
                <Ionicons name="images-outline" size={13} color="#8e8e93" />
                <Text style={styles.diagramLabel}>{t("howToUse.diagramLabel")}</Text>
              </View>
              <tab.Diagram />
            </>
          ) : null}
          <tab.Intro />
        </View>
        {tab.subsections.map((sub) => {
          const key = `${tab.id}:${sub.headingKey}`;
          const isOpen = expanded.has(key);
          return (
            <View key={sub.headingKey} style={styles.subsection}>
              <Pressable
                onPress={() => toggleSubsection(key)}
                style={styles.subsectionHeadingRow}
                hitSlop={4}
              >
                <View style={styles.subsectionIconBadge}>
                  <Ionicons name={sub.icon} size={14} color={colors.primary} />
                </View>
                <Text style={styles.subsectionHeading}>{t(sub.headingKey)}</Text>
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#8e8e93"
                />
              </Pressable>
              {isOpen ? (
                <View style={styles.subsectionBody}>
                  {sub.bulletKeys.map((bulletKey) => (
                    <View key={bulletKey} style={styles.bulletRow}>
                      <View style={styles.bulletDot} />
                      <Text style={styles.bulletText}>{t(bulletKey)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },

  tabBar: { flexGrow: 0, backgroundColor: "#fff" },
  tabBarContent: { paddingHorizontal: spacing.screenPadding, paddingVertical: 10, gap: 8 },
  tabChip: {
    fontSize: 14,
    fontWeight: "600",
    color: "#3c3c43",
    backgroundColor: colors.searchBarBackground,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  tabChipSelected: { backgroundColor: colors.primary, color: "#fff" },

  content: { padding: spacing.screenPadding, paddingBottom: 40 },

  section: {
    backgroundColor: "#fff",
    borderRadius: radius.card,
    padding: spacing.cardPadding + 4,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: fontSize.cardTitle, fontWeight: "700", color: "#1c1c1e", marginBottom: 12 },
  sectionBody: { fontSize: fontSize.body, color: "#3c3c43", lineHeight: 22, marginTop: 12 },
  inlineIcon: { transform: [{ translateY: 2 }] },

  subsection: {
    backgroundColor: "#fff",
    borderRadius: radius.card,
    marginBottom: 12,
    overflow: "hidden",
  },
  subsectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.cardPadding + 4,
  },
  subsectionIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#e5f0fb",
    alignItems: "center",
    justifyContent: "center",
  },
  subsectionHeading: { flex: 1, fontSize: 14, fontWeight: "700", color: "#1c1c1e" },
  subsectionBody: {
    paddingHorizontal: spacing.cardPadding + 4,
    paddingBottom: spacing.cardPadding + 4,
  },
  bulletRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#8e8e93", marginTop: 8 },
  bulletText: { flex: 1, fontSize: fontSize.body, color: "#3c3c43", lineHeight: 21 },

  diagramLabelRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  diagramLabel: { fontSize: 11, fontWeight: "700", color: "#8e8e93", letterSpacing: 0.5 },
  diagramBox: {
    backgroundColor: "#f7f7fa",
    borderRadius: radius.card,
    padding: 12,
    marginBottom: 4,
  },
  diagramSettingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  diagramSettingsIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#e5f0fb",
    alignItems: "center",
    justifyContent: "center",
  },
  diagramSettingsLabel: { flex: 1, fontSize: 13, color: "#3c3c43" },
  diagramRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  diagramSpacer: { width: 8 },
  diagramTile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  diagramTileMuted: { backgroundColor: "#e5e5ea" },
  diagramTapRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  diagramTapLabel: { fontSize: 13, fontWeight: "600", color: colors.primary },
  diagramCaptionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  diagramCaption: { fontSize: 13, color: "#8e8e93", flexShrink: 1 },

  diagramFakeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: radius.card,
    padding: 10,
    gap: 8,
  },
  diagramFakeRowText: { flex: 1, gap: 6 },
  diagramFakeLine: { height: 8, borderRadius: 4, backgroundColor: "#e5e5ea", width: "85%" },

  diagramFilterRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  diagramPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  diagramConvergeRow: { flexDirection: "row", justifyContent: "center", gap: 20 },
  diagramPillWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginRight: 8,
    marginTop: 6,
  },
  diagramPillText: { fontSize: 12, fontWeight: "600" },

  diagramSegment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
  },
  diagramSegmentMuted: { backgroundColor: "transparent" },
  diagramSegmentText: { fontSize: 12, fontWeight: "600", color: colors.primary },
  diagramSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  diagramSearchText: { fontSize: 13, color: "#8e8e93" },
});
