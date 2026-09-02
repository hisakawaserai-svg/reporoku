import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as blocksRepo from "../db/repositories/blocks";
import * as sessionsRepo from "../db/repositories/sessions";
import type { Block, Session } from "../db/types";
import { buildReportText, buildStructuredReport, reportFileName, type ReportTemplate } from "../utils/report";
import { buildReportPdfHtml, reportPdfFileName } from "../utils/reportPdf";
import * as colors from "../theme/colors";
import { radius, spacing } from "../theme/spacing";

type IconName = keyof typeof Ionicons.glyphMap;

// ノート詳細画面のバッジ(activeBadges)と同じアイコン・配色に揃える
const SUMMARY_ICONS: { key: string; icon: IconName; color: string }[] = [
  { key: "star", icon: "star", color: colors.star.accent },
  { key: "todo", icon: "checkmark-circle", color: colors.todo.accent },
  { key: "question", icon: "help-circle", color: colors.question.accent },
];

const TEMPLATES: { key: ReportTemplate; labelKey: string; descriptionKey: string }[] = [
  { key: "summary", labelKey: "report.template.summary.label", descriptionKey: "report.template.summary.description" },
  { key: "full", labelKey: "report.template.full.label", descriptionKey: "report.template.full.description" },
];

// プレビューが長くなりすぎる(特に「全文」テンプレート)場合、画面を占領しないようこの行数までで
// 折りたたむ。まとめ画面の「完了したものも見る」などと同じアコーディオン形式を踏襲する
const PREVIEW_LINE_LIMIT = 15;

// 書き出したテキストファイルの一時保存先。DBやユーザーデータとは無関係の、
// 書き出しのたびに上書きしてよい一時的な出力先として documentDirectory 配下に置く
const reportsDirectory = new Directory(Paths.document, "reports");

async function writeReportFile(session: Session, text: string, t: TFunction): Promise<File> {
  if (!reportsDirectory.exists) {
    reportsDirectory.create({ intermediates: true, idempotent: true });
  }
  const file = new File(reportsDirectory, reportFileName(session, t));
  file.create({ overwrite: true });
  file.write(text);
  return file;
}

// expo-printが書き出す一時PDF(cache配下・ランダムなファイル名)を、テキスト出力と同じ
// reports/ディレクトリへノート名でコピーし直す(ファイル名を分かりやすくするため)
async function writeReportPdfFile(session: Session, generatedUri: string, t: TFunction): Promise<File> {
  if (!reportsDirectory.exists) {
    reportsDirectory.create({ intermediates: true, idempotent: true });
  }
  const destination = new File(reportsDirectory, reportPdfFileName(session, t));
  if (destination.exists) {
    destination.delete();
  }
  const generated = new File(generatedUri);
  await generated.copy(destination);
  return destination;
}

export default function ReportScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const route = useRoute<RouteProp<RootStackParamList, "Report">>();
  const sessionId = route.params.noteId;
  const [template, setTemplate] = useState<ReportTemplate>("summary");
  const [session, setSession] = useState<Session | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      sessionsRepo
        .getById(sessionId)
        .then(setSession)
        .catch((e) => console.warn("[DB] セッションの取得に失敗しました", e));
      blocksRepo
        .listBySessionId(sessionId)
        .then(setBlocks)
        .catch((e) => console.warn("[DB] ブロック一覧の取得に失敗しました", e));
    }, [sessionId])
  );

  const structuredReport = session ? buildStructuredReport(session, blocks, template) : null;
  const reportText = structuredReport ? buildReportText(structuredReport, t, lang) : "";
  const reportLines = reportText.split("\n");
  const previewOverflowing = reportLines.length > PREVIEW_LINE_LIMIT;
  const previewText =
    previewOverflowing && !previewExpanded
      ? reportLines.slice(0, PREVIEW_LINE_LIMIT).join("\n")
      : reportText;

  const selectTemplate = (key: ReportTemplate) => {
    setTemplate(key);
    setPreviewExpanded(false);
  };

  const handleCopy = async () => {
    if (!session) return;
    try {
      await Clipboard.setStringAsync(reportText);
      Alert.alert(t("report.copy.doneTitle"), t("report.copy.doneMessage"));
    } catch (e) {
      console.warn("[Clipboard] コピーに失敗しました", e);
      Alert.alert(t("report.copy.failed"));
    }
  };

  const handleShareSheet = async () => {
    if (!session) return;
    try {
      await Share.share({ message: reportText, title: session.title });
    } catch (e) {
      console.warn("[Share] 共有に失敗しました", e);
    }
  };

  const handleSaveFile = async () => {
    if (!session) return;
    try {
      const file = await writeReportFile(session, reportText, t);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/plain",
          dialogTitle: reportFileName(session, t),
        });
      } else {
        Alert.alert(t("settings.backup.savedTitle"), file.uri);
      }
    } catch (e) {
      console.warn("[FS] テキストファイルの保存に失敗しました", e);
      Alert.alert(t("report.saveFailed"));
    }
  };

  // 写真を含むPDFは常に「要点抜粋」の構成で書き出す(全文テンプレートを選んでいても切り替わらない)
  const handleExportPdf = async () => {
    if (!session || pdfGenerating) return;
    setPdfGenerating(true);
    try {
      const summaryReport = buildStructuredReport(session, blocks, "summary");
      const html = await buildReportPdfHtml(summaryReport, blocks, session, t, lang);
      const { uri } = await Print.printToFileAsync({ html });
      const file = await writeReportPdfFile(session, uri, t);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          dialogTitle: reportPdfFileName(session, t),
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert(t("settings.backup.savedTitle"), file.uri);
      }
    } catch (e) {
      console.warn("[PDF] PDFの生成に失敗しました", e);
      Alert.alert(t("report.pdf.generateFailed"));
    } finally {
      setPdfGenerating(false);
    }
  };

  const EXPORT_ACTIONS = [
    { key: "copy", labelKey: "report.export.copy", onPress: handleCopy },
    { key: "share", labelKey: "report.export.share", onPress: handleShareSheet },
    { key: "save", labelKey: "report.export.saveFile", onPress: handleSaveFile },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>{t("report.templateHeader")}</Text>
        <View style={styles.templateGroup}>
          {TEMPLATES.map((tpl) => (
            <TouchableOpacity
              key={tpl.key}
              style={[styles.templateCard, template === tpl.key && styles.templateCardSelected]}
              onPress={() => selectTemplate(tpl.key)}
            >
              <View style={[styles.radio, template === tpl.key && styles.radioSelected]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.templateLabel}>{t(tpl.labelKey)}</Text>
                <View style={styles.templateDescriptionRow}>
                  {tpl.key === "summary" &&
                    SUMMARY_ICONS.map((icon) => (
                      <Ionicons key={icon.key} name={icon.icon} size={15} color={icon.color} />
                    ))}
                  <Text style={styles.templateDescription}>{t(tpl.descriptionKey)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.previewHeaderRow}>
          <Text style={[styles.sectionHeader, styles.previewSectionHeaderText]}>{t("report.previewHeader")}</Text>
          {session && previewOverflowing ? (
            <TouchableOpacity onPress={() => setPreviewExpanded((v) => !v)} hitSlop={8}>
              <Text style={styles.previewToggleText}>
                {previewExpanded
                  ? t("report.preview.collapse")
                  : t("report.preview.expand", { count: reportLines.length })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          activeOpacity={previewOverflowing ? 0.7 : 1}
          disabled={!session || !previewOverflowing}
          onPress={() => setPreviewExpanded((v) => !v)}
        >
          <View style={styles.previewBox}>
            <Text style={styles.previewText} selectable>
              {session ? previewText : t("report.loading")}
            </Text>
            {session && previewOverflowing && !previewExpanded ? (
              <Text style={styles.previewFadeNotice}>…</Text>
            ) : null}
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>{t("report.exportHeader")}</Text>
        <View style={styles.card}>
          {EXPORT_ACTIONS.map((action, i) => (
            <TouchableOpacity
              key={action.key}
              style={[styles.row, i < EXPORT_ACTIONS.length - 1 && styles.rowDivider]}
              onPress={action.onPress}
              disabled={!session}
            >
              <Text style={styles.rowLabel}>{t(action.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>{t("report.pdfHeader")}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={handleExportPdf}
            disabled={!session || pdfGenerating}
          >
            {pdfGenerating ? (
              <ActivityIndicator size="small" color="#06c" />
            ) : (
              <Text style={styles.rowLabel}>{t("report.pdf.exportButton")}</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.pdfCaption}>{t("report.pdf.caption")}</Text>
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
    borderRadius: radius.card,
    padding: spacing.cardPadding,
    borderWidth: 1,
    borderColor: colors.divider,
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
  templateDescriptionRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  templateDescription: { fontSize: 13, color: "#8e8e93" },
  previewHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 6,
  },
  previewSectionHeaderText: { marginTop: 0, marginBottom: 0 },
  previewBox: {
    backgroundColor: "#fff",
    borderRadius: radius.card,
    padding: spacing.cardPadding,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  previewText: { fontSize: 13, lineHeight: 20, color: "#1c1c1e" },
  previewFadeNotice: { fontSize: 13, lineHeight: 20, color: "#c7c7cc", marginTop: 2 },
  previewToggleText: {
    fontSize: 13,
    color: "#06c",
    fontWeight: "600",
  },
  card: { backgroundColor: "#fff", borderRadius: radius.card, overflow: "hidden" },
  row: { paddingVertical: spacing.cardPadding, paddingHorizontal: spacing.cardPadding },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 16, color: "#06c" },
  pdfCaption: { fontSize: 12, color: "#8e8e93", marginTop: 8, lineHeight: 17 },
});
