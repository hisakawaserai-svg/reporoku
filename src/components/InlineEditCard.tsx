import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import * as colors from "../theme/colors";
import { radius, spacing } from "../theme/spacing";

type IconName = keyof typeof Ionicons.glyphMap;

export type InlineEditKind = "star" | "todo" | "question" | "neutral";

// 種別ごとの配色(アイコン・バッジ背景・保存ボタン)。「まとめ」画面のクイック追加/編集
// カードと揃えている
const KIND_STYLE: Record<
  InlineEditKind,
  { icon: IconName; iconColor: string; badgeBg: string; saveColor: string }
> = {
  star: { icon: "star", iconColor: colors.star.accent, badgeBg: colors.star.background, saveColor: colors.star.accent },
  todo: { icon: "checkmark", iconColor: colors.todo.accent, badgeBg: colors.todo.background, saveColor: colors.todo.accent },
  question: {
    icon: "help",
    iconColor: colors.question.accent,
    badgeBg: colors.question.background,
    saveColor: colors.question.accent,
  },
  neutral: { icon: "create-outline", iconColor: "#8e8e93", badgeBg: "#f2f2f7", saveColor: colors.primary },
};

// タイムライン(ノート詳細画面)で使う、行内展開型の編集カード。「テキスト編集」「回答を記入」
// 「一言メモを書く」「グループを設定」「メモを追加」など、テキスト入力を伴う編集操作を
// すべてこの1つの見た目に統一する。「まとめ」画面のクイック追加/編集カードと同じ、
// アイコンバッジ付きヘッダー+下線入力+丸型保存ボタンのレイアウトを、モーダルではなく
// タイムライン中にインライン展開する形で使う
export default function InlineEditCard({
  kind = "neutral",
  title,
  subtitle,
  extra,
  value,
  onChangeText,
  placeholder,
  caption,
  showSecondary,
  secondaryValue,
  onSecondaryChange,
  secondaryPlaceholder,
  secondaryCaption,
  onCancel,
  onConfirm,
  confirmDisabled,
}: {
  kind?: InlineEditKind;
  // 省略した場合、ヘッダー(アイコンバッジ+タイトル)自体を出さない。テキスト編集のように
  // 何を編集しているかが行の文脈から自明な場合は、タイトルを付けず本文入力だけを見せる
  title?: string;
  subtitle?: string;
  // グループ選択チップなど、入力欄の上に足したい追加コンテンツ(無ければ何も出さない)
  extra?: React.ReactNode;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  caption?: string;
  // 質問の「Q」「A」編集のように、本文入力の下にもう1つ入力欄を足したい場合に使う
  showSecondary?: boolean;
  secondaryValue?: string;
  onSecondaryChange?: (text: string) => void;
  secondaryPlaceholder?: string;
  secondaryCaption?: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const kindStyle = KIND_STYLE[kind];
  return (
    <View style={styles.card}>
      {title ? (
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: kindStyle.badgeBg }]}>
            <Ionicons name={kindStyle.icon} size={22} color={kindStyle.iconColor} />
          </View>
          <View style={styles.headerTextCol}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
      ) : null}

      {extra}

      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline
        autoFocus
      />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}

      {showSecondary ? (
        <>
          <TextInput
            style={styles.input}
            value={secondaryValue}
            onChangeText={onSecondaryChange}
            placeholder={secondaryPlaceholder}
            multiline
          />
          {secondaryCaption ? <Text style={styles.caption}>{secondaryCaption}</Text> : null}
        </>
      ) : null}

      <View style={styles.footer}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: confirmDisabled ? "#d1d1d6" : kindStyle.saveColor },
          ]}
          onPress={onConfirm}
          disabled={confirmDisabled}
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.formCard,
    paddingHorizontal: spacing.formCardPadding,
    paddingTop: spacing.formCardPadding,
    paddingBottom: spacing.formCardPadding,
    marginVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextCol: { flex: 1 },
  title: { fontSize: 17, fontWeight: "700", color: "#1c1c1e" },
  subtitle: { fontSize: 12, color: "#8e8e93", marginTop: 2 },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: "#d1d1d6",
    paddingVertical: 8,
    fontSize: 16,
    color: "#1c1c1e",
    minHeight: 40,
    textAlignVertical: "top",
  },
  caption: { fontSize: 12, color: "#8e8e93", marginTop: 6 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },
  cancelText: { fontSize: 16, color: "#8e8e93" },
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
});
