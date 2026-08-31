import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
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
      <InlineIcon name="star" color={colors.star.accent} />・
      <InlineIcon name="checkmark-circle" color={colors.todo.accent} />・
      <InlineIcon name="help-circle" color={colors.question.accent} />
      は画面を見ずに1タップでマークできます。{"\n"}
      長押しすると、直近の発言一覧から選んで付け直せます。{"\n"}
      <InlineIcon name="camera" color="#57575c" />
      でスライド撮影、
      <InlineIcon name="create" color="#57575c" />
      で短いメモも残せます。
    </Text>
  );
}

function NoteDetailIntro() {
  return (
    <Text style={styles.sectionBody}>
      発言をタップすると、その位置から音声が再生されます。{"\n"}
      長押しでテキストの編集、前後の発言との結合・分割ができます。{"\n"}
      上部のフィルタで、<InlineIcon name="star" color={colors.star.accent} />や
      <InlineIcon name="help-circle" color={colors.question.accent} />
      だけを絞り込んで表示できます。
    </Text>
  );
}

function SummaryIntro() {
  return (
    <Text style={styles.sectionBody}>
      複数の研修・会議を横断して、未対応のTodo、未解決の質問、{"\n"}
      重要な発言をまとめて確認できます。
    </Text>
  );
}

function NotesListIntro() {
  return (
    <Text style={styles.sectionBody}>
      過去の記録をリストやカレンダーで探せます。検索バーで発言内容{"\n"}
      からも検索できます(2文字以下では検索できません)。
    </Text>
  );
}

function SettingsIntro() {
  return (
    <Text style={styles.sectionBody}>
      再生の挙動や録音品質、バックアップなど、設定画面から調整できる項目と、{"\n"}
      その意味をまとめています。
    </Text>
  );
}

function RecordDiagram() {
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
        <Text style={styles.diagramTapLabel}>1タップでマーク</Text>
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="time-outline" size={16} color="#8e8e93" />
        <Text style={styles.diagramCaption}>長押し → 直近の発言一覧から選び直す</Text>
      </View>
    </View>
  );
}

function NoteDetailDiagram() {
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
        <Text style={styles.diagramCaption}>タップ → その位置から音声を再生</Text>
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
        <Text style={styles.diagramCaption}>長押し → 編集・前後の発言と結合/分割</Text>
      </View>

      <View style={styles.diagramFilterRow}>
        <View style={[styles.diagramPill, { backgroundColor: colors.star.background }]}>
          <Ionicons name="star" size={13} color={colors.star.accent} />
        </View>
        <View style={[styles.diagramPill, { backgroundColor: colors.question.background }]}>
          <Ionicons name="help-circle" size={13} color={colors.question.accent} />
        </View>
        <Text style={styles.diagramCaption}>上部フィルタで絞り込み表示</Text>
      </View>
    </View>
  );
}

function SummaryDiagram() {
  return (
    <View style={styles.diagramBox}>
      <View style={styles.diagramConvergeRow}>
        {[0, 1, 2].map((i) => (
          <Ionicons key={i} name="document-text-outline" size={18} color="#8e8e93" />
        ))}
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="arrow-down" size={14} color={colors.primary} />
        <Text style={styles.diagramCaption}>複数の研修・会議を横断して集約</Text>
      </View>
      <View style={styles.diagramRow}>
        <View style={[styles.diagramPillWide, { backgroundColor: colors.todo.background }]}>
          <Ionicons name="checkmark-circle" size={14} color={colors.todo.accent} />
          <Text style={[styles.diagramPillText, { color: colors.todo.accent }]}>未対応Todo</Text>
        </View>
        <View style={[styles.diagramPillWide, { backgroundColor: colors.question.background }]}>
          <Ionicons name="help-circle" size={14} color={colors.question.accent} />
          <Text style={[styles.diagramPillText, { color: colors.question.accent }]}>未解決の質問</Text>
        </View>
      </View>
      <View style={styles.diagramRow}>
        <View style={[styles.diagramPillWide, { backgroundColor: colors.star.background }]}>
          <Ionicons name="star" size={14} color={colors.star.accent} />
          <Text style={[styles.diagramPillText, { color: colors.star.accent }]}>重要な発言</Text>
        </View>
      </View>
    </View>
  );
}

function NotesListDiagram() {
  return (
    <View style={styles.diagramBox}>
      <View style={styles.diagramRow}>
        <View style={styles.diagramSegment}>
          <Ionicons name="list-outline" size={16} color={colors.primary} />
          <Text style={styles.diagramSegmentText}>リスト</Text>
        </View>
        <View style={[styles.diagramSegment, styles.diagramSegmentMuted]}>
          <Ionicons name="calendar-outline" size={16} color="#8e8e93" />
          <Text style={[styles.diagramSegmentText, { color: "#8e8e93" }]}>カレンダー</Text>
        </View>
      </View>
      <View style={styles.diagramSearchRow}>
        <Ionicons name="search" size={16} color="#8e8e93" />
        <Text style={styles.diagramSearchText}>発言内容を検索…</Text>
      </View>
      <View style={styles.diagramCaptionRow}>
        <Ionicons name="information-circle-outline" size={16} color="#8e8e93" />
        <Text style={styles.diagramCaption}>2文字以下では検索できません</Text>
      </View>
    </View>
  );
}

function SettingsDiagram() {
  const rows: { icon: IconName; label: string }[] = [
    { icon: "play-skip-back-outline", label: "再生開始位置" },
    { icon: "musical-notes-outline", label: "録音サンプルレート" },
    { icon: "bluetooth-outline", label: "外部マイク" },
    { icon: "archive-outline", label: "バックアップ" },
  ];
  return (
    <View style={styles.diagramBox}>
      {rows.map((r) => (
        <View key={r.icon} style={styles.diagramSettingsRow}>
          <View style={styles.diagramSettingsIcon}>
            <Ionicons name={r.icon} size={16} color={colors.primary} />
          </View>
          <Text style={styles.diagramSettingsLabel}>{r.label}</Text>
          <Ionicons name="chevron-forward" size={14} color="#c7c7cc" />
        </View>
      ))}
    </View>
  );
}

type Subsection = {
  heading: string;
  icon: IconName;
  bullets: string[];
};

const RECORD_SUBSECTIONS: Subsection[] = [
  {
    heading: "一時停止と終了の違い",
    icon: "pause-circle-outline",
    bullets: [
      "「一時停止」はまだ記録の途中です。ノートとして保存されるのは「終了」を押した時です。",
      "一時停止中は経過時間のタイマーも止まり、再開すると続きから計測されます。",
    ],
  },
  {
    heading: "マークは複数付けられる",
    icon: "pricetags-outline",
    bullets: [
      "重要・ToDo・質問は同じ発言に同時に付けられます。付いている発言は行の色やアイコンで区別できます。",
      "長押しで開く「直近の発言から選ぶ」モードでは、画面が自動でスクロールしなくなるので、過去の発言を落ち着いて選べます。",
    ],
  },
  {
    heading: "自動スクロールと新着バッジ",
    icon: "arrow-down-circle-outline",
    bullets: [
      "発言が増えるたびに、通常はタイムラインが自動で一番下までスクロールします。",
      "長押しメニューを開いている間などは自動スクロールが止まり、画面外に新着がある時だけ「↓ 新着N件」のバッジが表示されます。",
    ],
  },
  {
    heading: "セクション分け(段落分け)",
    icon: "reader-outline",
    bullets: [
      "発言と発言の間が一定時間空くと、自動でセクション(段落)に分かれます。オン/オフと間隔は設定画面から調整できます。",
      "録音を開始した時点の設定がその録音全体で使われ、録音の途中では変更できません。",
    ],
  },
  {
    heading: "録音が途中で終了してしまった時",
    icon: "warning-outline",
    bullets: [
      "アプリが強制終了しても、次に開いた時に「前回の録音を再開する / 内容だけ見る / 破棄する」を選べます。",
      "発言・マーク・写真・音声のいずれも記録されなかった空の録音は、確認なしに自動で破棄されます。",
    ],
  },
  {
    heading: "スリープモード",
    icon: "moon-outline",
    bullets: [
      "右上の月アイコンをタップすると、画面を暗くして直近の発言だけを表示する省電力モードに切り替わります。ポケットに入れたまま録音したい時などに使えます。",
      "画面のどこかをタップすると通常表示に戻ります。一時停止・終了・重要マーク・写真の操作はスリープ中でも下部のボタンから行えます。",
    ],
  },
  {
    heading: "リセットボタン",
    icon: "refresh-outline",
    bullets: [
      "収録中に表示される「リセット」ボタンは、保存せずにここまでの録音(文字起こし・メモ・写真・音声)をすべて破棄して待機中の状態に戻します。誤って録音を始めてしまった時などに使います。",
      "確認ダイアログで「リセットする」を選ぶと元に戻せないため、内容を残したい場合は代わりに「終了」を使ってください。",
    ],
  },
];

const NOTE_DETAIL_SUBSECTIONS: Subsection[] = [
  {
    heading: "長押しメニューは発言の種類で変わる",
    icon: "hand-left-outline",
    bullets: [
      "重要の発言には「一言メモ」「グループ設定」、質問の発言には「回答を記入」、ToDoの発言には「完了にする」など、種類ごとに専用の操作が追加されます。",
      "テキストのコピーもここから行えます。",
    ],
  },
  {
    heading: "結合・分割",
    icon: "git-merge-outline",
    bullets: [
      "「前と結合」「次と結合」で隣り合う発言をひとつにまとめられます(写真の記録は結合できません)。",
      "結合すると重要・ToDo・質問のマークは両方の発言から引き継がれます。",
      "「分割」はタップした文字位置でテキストを前後2つに分けます(本文が2文字以上ある発言のみ)。",
    ],
  },
  {
    heading: "この画面内の「まとめ」タブ",
    icon: "layers-outline",
    bullets: [
      "上部の「まとめ」タブは、まとめ画面(タブバーの方)とは別物で、このノート1件分の重要・質問・ToDo・写真・メモだけを種類ごとに表示します。",
    ],
  },
  {
    heading: "「音声がありません」の通知",
    icon: "alert-circle-outline",
    bullets: [
      "アプリの強制終了で音声が失われた場合か、ストレージ管理で音声だけを削除した場合に表示されます。どちらもテキストの記録自体は残っています。",
    ],
  },
  {
    heading: "書き出し",
    icon: "download-outline",
    bullets: [
      "右上の書き出しアイコンから、「要点抜粋(重要・ToDo・質問のみ)」または「全文」を選んでコピー・共有・ファイル保存ができます。",
      "書き出したテキスト内の記号の意味: ★=重要な発言、❓=質問、📝=メモ、ToDoは☑️(未完了)と✅(完了)の2種類で完了状態が分かるようになっています。",
      "要点抜粋では、★・❓・📝は各セクションの見出しにのみ付き(行ごとには繰り返しません)、ToDoの☑️/✅だけは完了状態が行ごとに違うため各行に表示されます。写真は絵文字ではなく「(写真)」という文字で示されます。",
    ],
  },
];

const SUMMARY_SUBSECTIONS: Subsection[] = [
  {
    heading: "完了・解決済みは初期状態では隠れている",
    icon: "eye-off-outline",
    bullets: [
      "完了済みのToDoは「完了したものも見る」を開くまで表示されません。",
      "質問も未解決のみが初期表示で、「解決済み・保留も見る」で残りが表示されます。",
    ],
  },
  {
    heading: "質問は「保留」にできる",
    icon: "time-outline",
    bullets: ["削除せずに一覧から目立たなくしたい場合は、「保留にする」を使います。"],
  },
  {
    heading: "重要はグループにまとめられる",
    icon: "albums-outline",
    bullets: ["同じグループ名を付けた重要は、ノートをまたいで1つのカードにまとめて表示されます。"],
  },
  {
    heading: "項目から元のノートへ",
    icon: "open-outline",
    bullets: [
      "各項目をタップすると内容を編集でき、ノートアイコンをタップすると元のノートの該当箇所へジャンプします。",
      "ToDo・質問タブでは、左下の+ボタンから録音を伴わずにその場で追加できます。",
    ],
  },
];

const NOTES_LIST_SUBSECTIONS: Subsection[] = [
  {
    heading: "複数選択して一括削除",
    icon: "checkbox-outline",
    bullets: [
      "リストタブでカードを長押しすると選択モードに入ります(右上の「編集」からも入れます)。",
      "選択モード中だけ、各ノートの使用容量(音声+写真)が表示されます。",
      "削除すると音声・写真・メモを含めて完全に削除され、元に戻せません。",
    ],
  },
  {
    heading: "カレンダー表示",
    icon: "calendar-outline",
    bullets: [
      "日付の下の青い点は、その日に記録があることを示します。",
      "月のラベルをタップすると年月をまとめて選べます(記録がある月は太字で表示)。",
      "カレンダータブでは一括選択はできませんが、長押しで開く/削除は可能です。",
    ],
  },
];

const SETTINGS_SUBSECTIONS: Subsection[] = [
  {
    heading: "再生開始位置(手前の秒数)",
    icon: "play-skip-back-outline",
    bullets: [
      "ノート詳細でタップ再生する時に、発言の頭を聞き逃さないよう少し手前から再生を始めるための秒数です。",
    ],
  },
  {
    heading: "録音サンプルレート",
    icon: "musical-notes-outline",
    bullets: [
      "標準(容量が小さい)と高音質(容量が大きい)から選べます。",
      "変更が反映されるのは次回の録音からで、すでに録音済みのノートには影響しません。",
    ],
  },
  {
    heading: "外部マイクを使う",
    icon: "bluetooth-outline",
    bullets: [
      "Bluetoothイヤホンやピンマイクを使う時はオンにします。",
      "部屋のスピーカーマイクで広く拾いたい場合はオフのままにします。",
    ],
  },
  {
    heading: "セクション分けを表示する / 新しい録音のデフォルト間隔",
    icon: "timer-outline",
    bullets: [
      "録音画面で発言の間が空いた時に自動で段落分けするかどうかと、その間隔の初期値です。",
      "ここで変更しても、すでにあるノートの区切りには影響しません(次に録音を始める時から適用されます)。",
    ],
  },
  {
    heading: "ストレージ管理",
    icon: "folder-outline",
    bullets: [
      "ノートごとの使用容量を確認できます。",
      "「音声のみ削除」でテキストの記録を残したまま音声だけを削除できます(元に戻せません)。",
      "参照されていない不要なファイルをまとめて削除するクリーンアップ機能もあります。",
    ],
  },
  {
    heading: "バックアップの作成・復元",
    icon: "archive-outline",
    bullets: [
      "バックアップにはデータベース・音声・写真が含まれます(書き出し済みのレポートファイルは含まれません)。",
      "復元すると、その時点のアプリ内のデータはすべて上書きされます。実行前に必ず確認が表示されます。",
      "復元が完了したら、変更を反映するためにアプリを再起動してください。",
    ],
  },
];

const TABS: {
  id: TabId;
  label: string;
  screenName: string;
  title: string;
  Intro: () => React.JSX.Element;
  Diagram?: () => React.JSX.Element;
  subsections: Subsection[];
}[] = [
  {
    id: "record",
    label: "録音",
    screenName: "RecordScreen",
    title: "録音画面の使い方",
    Intro: RecordIntro,
    Diagram: RecordDiagram,
    subsections: RECORD_SUBSECTIONS,
  },
  {
    id: "noteDetail",
    label: "ノート詳細",
    screenName: "NoteDetailScreen",
    title: "ノート詳細画面の使い方",
    Intro: NoteDetailIntro,
    Diagram: NoteDetailDiagram,
    subsections: NOTE_DETAIL_SUBSECTIONS,
  },
  {
    id: "summary",
    label: "まとめ",
    screenName: "SummaryScreen",
    title: "まとめ画面の使い方",
    Intro: SummaryIntro,
    Diagram: SummaryDiagram,
    subsections: SUMMARY_SUBSECTIONS,
  },
  {
    id: "notesList",
    label: "ノート一覧",
    screenName: "NotesScreen",
    title: "ノート一覧の使い方",
    Intro: NotesListIntro,
    Diagram: NotesListDiagram,
    subsections: NOTES_LIST_SUBSECTIONS,
  },
  {
    id: "settings",
    label: "設定",
    screenName: "SettingsScreen",
    title: "設定・バックアップ",
    Intro: SettingsIntro,
    Diagram: SettingsDiagram,
    subsections: SETTINGS_SUBSECTIONS,
  },
];

export default function HowToUseScreen() {
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
        {TABS.map((t) => (
          <Text
            key={t.id}
            onPress={() => setActiveTab(t.id)}
            style={[styles.tabChip, t.id === activeTab && styles.tabChipSelected]}
          >
            {t.label}
          </Text>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.content} key={tab.id}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{tab.title}</Text>
          {tab.Diagram ? (
            <>
              <View style={styles.diagramLabelRow}>
                <Ionicons name="images-outline" size={13} color="#8e8e93" />
                <Text style={styles.diagramLabel}>図解</Text>
              </View>
              <tab.Diagram />
            </>
          ) : null}
          <tab.Intro />
        </View>
        {tab.subsections.map((sub) => {
          const key = `${tab.id}:${sub.heading}`;
          const isOpen = expanded.has(key);
          return (
            <View key={sub.heading} style={styles.subsection}>
              <Pressable
                onPress={() => toggleSubsection(key)}
                style={styles.subsectionHeadingRow}
                hitSlop={4}
              >
                <View style={styles.subsectionIconBadge}>
                  <Ionicons name={sub.icon} size={14} color={colors.primary} />
                </View>
                <Text style={styles.subsectionHeading}>{sub.heading}</Text>
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#8e8e93"
                />
              </Pressable>
              {isOpen ? (
                <View style={styles.subsectionBody}>
                  {sub.bullets.map((bullet) => (
                    <View key={bullet} style={styles.bulletRow}>
                      <View style={styles.bulletDot} />
                      <Text style={styles.bulletText}>{bullet}</Text>
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
