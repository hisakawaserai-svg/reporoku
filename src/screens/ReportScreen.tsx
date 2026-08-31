import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { useFocusEffect, useRoute } from "@react-navigation/native";
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
import { buildReportText, reportFileName, type ReportTemplate } from "../utils/report";
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

const TEMPLATES: { key: ReportTemplate; label: string; description: string }[] = [
  { key: "summary", label: "要点抜粋", description: "のみ(デフォルト)" },
  { key: "full", label: "全文", description: "文字起こし全体を含む" },
];

// プレビューが長くなりすぎる(特に「全文」テンプレート)場合、画面を占領しないようこの行数までで
// 折りたたむ。まとめ画面の「完了したものも見る」などと同じアコーディオン形式を踏襲する
const PREVIEW_LINE_LIMIT = 15;

// 書き出したテキストファイルの一時保存先。DBやユーザーデータとは無関係の、
// 書き出しのたびに上書きしてよい一時的な出力先として documentDirectory 配下に置く
const reportsDirectory = new Directory(Paths.document, "reports");

async function writeReportFile(session: Session, text: string): Promise<File> {
  if (!reportsDirectory.exists) {
    reportsDirectory.create({ intermediates: true, idempotent: true });
  }
  const file = new File(reportsDirectory, reportFileName(session));
  file.create({ overwrite: true });
  file.write(text);
  return file;
}

// expo-printが書き出す一時PDF(cache配下・ランダムなファイル名)を、テキスト出力と同じ
// reports/ディレクトリへノート名でコピーし直す(ファイル名を分かりやすくするため)
async function writeReportPdfFile(session: Session, generatedUri: string): Promise<File> {
  if (!reportsDirectory.exists) {
    reportsDirectory.create({ intermediates: true, idempotent: true });
  }
  const destination = new File(reportsDirectory, reportPdfFileName(session));
  if (destination.exists) {
    destination.delete();
  }
  const generated = new File(generatedUri);
  await generated.copy(destination);
  return destination;
}

export default function ReportScreen() {
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

  const reportText = session ? buildReportText(session, blocks, template) : "";
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
      Alert.alert("コピーしました", "クリップボードにレポートをコピーしました。");
    } catch (e) {
      console.warn("[Clipboard] コピーに失敗しました", e);
      Alert.alert("コピーに失敗しました");
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
      const file = await writeReportFile(session, reportText);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/plain",
          dialogTitle: reportFileName(session),
        });
      } else {
        Alert.alert("保存しました", file.uri);
      }
    } catch (e) {
      console.warn("[FS] テキストファイルの保存に失敗しました", e);
      Alert.alert("保存に失敗しました");
    }
  };

  // 写真を含むPDFは常に「要点抜粋」の構成で書き出す(全文テンプレートを選んでいても切り替わらない)。
  // テキスト出力(buildReportText/buildExcerptSections)のロジック自体には一切手を加えていない
  const handleExportPdf = async () => {
    if (!session || pdfGenerating) return;
    setPdfGenerating(true);
    try {
      const html = await buildReportPdfHtml(session, blocks);
      const { uri } = await Print.printToFileAsync({ html });
      const file = await writeReportPdfFile(session, uri);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          dialogTitle: reportPdfFileName(session),
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("保存しました", file.uri);
      }
    } catch (e) {
      console.warn("[PDF] PDFの生成に失敗しました", e);
      Alert.alert("PDFの生成に失敗しました");
    } finally {
      setPdfGenerating(false);
    }
  };

  const EXPORT_ACTIONS = [
    { key: "copy", label: "クリップボードにコピー", onPress: handleCopy },
    { key: "share", label: "共有シート", onPress: handleShareSheet },
    { key: "save", label: "テキストファイルとして保存", onPress: handleSaveFile },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>テンプレート</Text>
        <View style={styles.templateGroup}>
          {TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.templateCard, template === t.key && styles.templateCardSelected]}
              onPress={() => selectTemplate(t.key)}
            >
              <View style={[styles.radio, template === t.key && styles.radioSelected]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.templateLabel}>{t.label}</Text>
                <View style={styles.templateDescriptionRow}>
                  {t.key === "summary" &&
                    SUMMARY_ICONS.map((icon) => (
                      <Ionicons key={icon.key} name={icon.icon} size={15} color={icon.color} />
                    ))}
                  <Text style={styles.templateDescription}>{t.description}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>プレビュー</Text>
        <View style={styles.previewBox}>
          <Text style={styles.previewText} selectable>
            {session ? previewText : "読み込み中..."}
          </Text>
          {session && previewOverflowing && !previewExpanded ? (
            <Text style={styles.previewFadeNotice}>…</Text>
          ) : null}
        </View>
        {session && previewOverflowing ? (
          <TouchableOpacity onPress={() => setPreviewExpanded((v) => !v)}>
            <Text style={styles.previewToggleText}>
              {previewExpanded ? "折りたたむ ▲" : `続きを見る(全${reportLines.length}行) ▼`}
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionHeader}>書き出し方法</Text>
        <View style={styles.card}>
          {EXPORT_ACTIONS.map((action, i) => (
            <TouchableOpacity
              key={action.key}
              style={[styles.row, i < EXPORT_ACTIONS.length - 1 && styles.rowDivider]}
              onPress={action.onPress}
              disabled={!session}
            >
              <Text style={styles.rowLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>写真付きPDF</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={handleExportPdf}
            disabled={!session || pdfGenerating}
          >
            {pdfGenerating ? (
              <ActivityIndicator size="small" color="#06c" />
            ) : (
              <Text style={styles.rowLabel}>PDFとして書き出す</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.pdfCaption}>
          テンプレートの選択にかかわらず、要点抜粋(重要・ToDo・質問・Q&A)に写真を時系列順で加えて書き出します。
        </Text>
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
    marginTop: 8,
    textAlign: "center",
  },
  card: { backgroundColor: "#fff", borderRadius: radius.card, overflow: "hidden" },
  row: { paddingVertical: spacing.cardPadding, paddingHorizontal: spacing.cardPadding },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 16, color: "#06c" },
  pdfCaption: { fontSize: 12, color: "#8e8e93", marginTop: 8, lineHeight: 17 },
});
