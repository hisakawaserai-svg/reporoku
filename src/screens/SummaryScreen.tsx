import { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "../navigation/RootNavigator";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import type { ImportantGroupSummary } from "../db/repositories/blocks";
import type { TodoGroups } from "../db/repositories/blocks";
import type { BlockWithSession } from "../db/types";
import { genId } from "../utils/id";
import { RowLongPressMenu, useRowLongPressMenu, type RowMenuItem } from "../components/RowLongPressMenu";
import GroupSettingForm from "../components/GroupSettingForm";
import InlineEditCard from "../components/InlineEditCard";
import * as colors from "../theme/colors";
import { radius, spacing } from "../theme/spacing";
import { fontSize } from "../theme/typography";

type RowMenuData =
  | { kind: "todo" | "question"; block: BlockWithSession }
  | { kind: "star"; block: BlockWithSession; group?: { name: string; items: BlockWithSession[] } };

type TabKey = "all" | "star" | "todo" | "question";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "全て" },
  { key: "star", label: "重要" },
  { key: "todo", label: "Todo" },
  { key: "question", label: "質問" },
];

function formatDateSlash(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Todo/質問/★の「追加」「編集」で共通のモーダル外枠。中身のカード(InlineEditCard)は
// タイムライン(ノート詳細画面)のインライン編集と共通のコンポーネントを使い回す
// (元は「ノート」タブのToDo/質問タブにあった実装をそのままこちらへ移設したもの)
function EditCardModal({
  visible,
  onCancel,
  children,
}: {
  visible: boolean;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.itemFormKeyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.quickAddOverlay} onPress={onCancel}>
          <Pressable style={styles.editCardPanel} onPress={(e) => e.stopPropagation()}>
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function SummaryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [todos, setTodos] = useState<TodoGroups>({ pending: [], done: [] });
  const [showDoneTodos, setShowDoneTodos] = useState(false);
  const [questions, setQuestions] = useState<BlockWithSession[]>([]);
  const [showMoreQuestions, setShowMoreQuestions] = useState(false);
  const [starred, setStarred] = useState<BlockWithSession[]>([]);

  // ★重要/Todo/質問の各セクションをアコーディオンで開閉する。初期状態は全部開いている
  const [collapsedSections, setCollapsedSections] = useState<Set<"star" | "todo" | "question">>(
    new Set()
  );
  const toggleSection = (key: "star" | "todo" | "question") => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 行タップで開く本文編集。visibleを対象ブロックID等とは別のフラグにしているのは、
  // キャンセル時にモーダルがフェードアウトしている間に中身が変わって一瞬チラつくのを防ぐため
  // (中身のstateはキャンセルしても消さず、次にstartする時に上書きされるのに任せる)
  const [todoEditVisible, setTodoEditVisible] = useState(false);
  const [todoEditBlockId, setTodoEditBlockId] = useState<string | null>(null);
  const [todoEditDraft, setTodoEditDraft] = useState("");
  const [todoEditSubtitle, setTodoEditSubtitle] = useState("");

  // 質問の行タップで開く、Q(発言テキスト)とA(回答メモ)の編集
  const [answerPromptVisible, setAnswerPromptVisible] = useState(false);
  const [answerPromptBlockId, setAnswerPromptBlockId] = useState<string | null>(null);
  const [answerPromptQDraft, setAnswerPromptQDraft] = useState("");
  const [answerPromptDraft, setAnswerPromptDraft] = useState("");
  const [answerPromptSubtitle, setAnswerPromptSubtitle] = useState("");

  // ★の行タップ/長押しメニューで開く、一言メモの編集(デザインはTodo/質問と同じカード型)
  const [starEditVisible, setStarEditVisible] = useState(false);
  const [starEditBlockId, setStarEditBlockId] = useState<string | null>(null);
  const [starEditDraft, setStarEditDraft] = useState("");
  const [starEditSubtitle, setStarEditSubtitle] = useState("");

  // 行の長押しで開く選択肢メニュー(編集/完了・保留切替/ノートを開く)
  const rowMenu = useRowLongPressMenu<RowMenuData>();

  // FAB(Todo/質問タブでのみ表示)で開く、クイック追加(録音を伴わない項目)の入力
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [quickAddKind, setQuickAddKind] = useState<"todo" | "question">("todo");
  const [quickAddDraft, setQuickAddDraft] = useState("");
  const [quickAddAnswerDraft, setQuickAddAnswerDraft] = useState("");

  // ★行の長押しメニューから開く、グループ設定(ノートをまたいで束ねる)
  const [groupPromptVisible, setGroupPromptVisible] = useState(false);
  const [groupPromptBlockId, setGroupPromptBlockId] = useState<string | null>(null);
  const [groupPromptDraft, setGroupPromptDraft] = useState("");
  const [groupPromptExisting, setGroupPromptExisting] = useState<ImportantGroupSummary[]>([]);

  const load = useCallback(() => {
    blocksRepo.listAllTodos().then(setTodos);
    blocksRepo.listAllQuestions().then(setQuestions);
    blocksRepo.listStarredBlocks().then(setStarred);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goToBlock = (block: BlockWithSession) => {
    navigation.navigate("NoteDetail", { noteId: block.sessionId, jumpToBlockId: block.id });
  };

  const startTodoEdit = (block: BlockWithSession) => {
    setTodoEditBlockId(block.id);
    setTodoEditDraft(block.text ?? "");
    setTodoEditSubtitle(
      `${block.sessionTitle || "無題のノート"} ・ ${formatDateSlash(block.sessionStartedAt)}`
    );
    setTodoEditVisible(true);
  };

  const cancelTodoEdit = () => {
    setTodoEditVisible(false);
  };

  const confirmTodoEdit = async () => {
    const id = todoEditBlockId;
    const text = todoEditDraft.trim();
    setTodoEditVisible(false);
    if (!id || !text) return;
    await blocksRepo.update(id, text);
    load();
  };

  const startAnswerPrompt = (block: BlockWithSession) => {
    setAnswerPromptBlockId(block.id);
    setAnswerPromptQDraft(block.text ?? "");
    setAnswerPromptDraft(block.questionTerm ?? "");
    setAnswerPromptSubtitle(
      `${block.sessionTitle || "無題のノート"} ・ ${formatDateSlash(block.sessionStartedAt)}`
    );
    setAnswerPromptVisible(true);
  };

  const cancelAnswerPrompt = () => {
    setAnswerPromptVisible(false);
  };

  const confirmAnswerPrompt = async () => {
    const id = answerPromptBlockId;
    const question = answerPromptQDraft.trim();
    const answer = answerPromptDraft;
    setAnswerPromptVisible(false);
    if (!id) return;
    if (question) await blocksRepo.update(id, question);
    await blocksRepo.answerQuestion(id, answer);
    load();
  };

  // ★の一言メモ編集。デザイン(カード型モーダル)はTodo/質問と共通のInlineEditCardを使い、
  // kind="star"の配色(金色/★アイコン)で表示する
  const startStarEdit = (block: BlockWithSession) => {
    setStarEditBlockId(block.id);
    setStarEditDraft(block.summaryNote ?? block.text ?? "");
    setStarEditSubtitle(
      `${block.sessionTitle || "無題のノート"} ・ ${formatDateSlash(block.sessionStartedAt)}`
    );
    setStarEditVisible(true);
  };

  const cancelStarEdit = () => {
    setStarEditVisible(false);
  };

  const confirmStarEdit = async () => {
    const id = starEditBlockId;
    const text = starEditDraft.trim();
    setStarEditVisible(false);
    if (!id) return;
    await blocksRepo.setSummaryNote(id, text);
    load();
  };

  const startQuickAdd = (kind: "todo" | "question") => {
    setQuickAddKind(kind);
    setQuickAddDraft("");
    setQuickAddAnswerDraft("");
    setQuickAddVisible(true);
  };

  const cancelQuickAdd = () => {
    setQuickAddVisible(false);
  };

  const confirmQuickAdd = async () => {
    const kind = quickAddKind;
    const text = quickAddDraft.trim();
    const answer = quickAddAnswerDraft.trim();
    setQuickAddVisible(false);
    if (!text) return;
    const session = await sessionsRepo.getOrCreateQuickSession();
    const id = genId();
    await blocksRepo.create({
      id,
      sessionId: session.id,
      kind: "note",
      startMs: 0,
      text,
      isTodo: kind === "todo",
      isQuestion: kind === "question",
    });
    if (kind === "question" && answer) {
      await blocksRepo.answerQuestion(id, answer);
    }
    load();
  };

  const toggleTodoDone = (block: BlockWithSession) => {
    blocksRepo.toggleTodoDone(block.id).then(load);
  };

  const toggleDeferred = (block: BlockWithSession) => {
    blocksRepo.setDeferred(block.id, !block.isDeferred).then(load);
  };

  // ★行の長押しメニュー「グループを設定」。既存のグループ名はクイック選択肢として出し、
  // 無ければテキスト入力で新規作成する(ノート詳細画面の同じ機能と揃えている)
  const startGroupPrompt = (block: BlockWithSession) => {
    setGroupPromptBlockId(block.id);
    setGroupPromptDraft(block.importantGroup ?? "");
    blocksRepo.listImportantGroupSummaries().then(setGroupPromptExisting);
    setGroupPromptVisible(true);
  };

  const cancelGroupPrompt = () => {
    setGroupPromptVisible(false);
  };

  const confirmGroupPrompt = async () => {
    const id = groupPromptBlockId;
    const group = groupPromptDraft;
    setGroupPromptVisible(false);
    if (!id) return;
    await blocksRepo.setImportantGroup(id, group);
    load();
  };

  const renderTodoRow = (block: BlockWithSession) => (
    <TouchableOpacity
      key={block.id}
      style={styles.todoCard}
      activeOpacity={0.7}
      onPress={() => startTodoEdit(block)}
      onLongPress={() => rowMenu.open(`todo:${block.id}`, { kind: "todo", block })}
      ref={rowMenu.registerRef(`todo:${block.id}`)}
    >
      <TouchableOpacity hitSlop={8} onPress={() => toggleTodoDone(block)}>
        <Ionicons
          name={block.todoDone ? "checkmark-circle" : "ellipse-outline"}
          size={24}
          color={block.todoDone ? colors.todo.accent : "#c7c7cc"}
        />
      </TouchableOpacity>
      <View style={styles.rowTextCol}>
        <Text style={[styles.todoText, block.todoDone && styles.todoTextDone]}>
          {block.text ?? ""}
        </Text>
        <Text style={styles.cardSubMeta}>{block.sessionTitle || "無題のノート"}</Text>
      </View>
      <TouchableOpacity hitSlop={8} onPress={() => goToBlock(block)}>
        <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderQuestionRow = (block: BlockWithSession) => {
    const answer = block.questionTerm?.trim();
    const resolved = !!answer;
    return (
      <TouchableOpacity
        key={block.id}
        style={styles.todoCard}
        activeOpacity={0.7}
        onPress={() => startAnswerPrompt(block)}
        onLongPress={() => rowMenu.open(`question:${block.id}`, { kind: "question", block })}
        ref={rowMenu.registerRef(`question:${block.id}`)}
      >
        <View
          style={[
            styles.questionIconBadge,
            resolved ? styles.questionIconBadgeResolved : styles.questionIconBadgeOpen,
          ]}
        >
          {resolved ? (
            <Ionicons name="checkmark" size={16} color={colors.todo.accent} />
          ) : (
            <Text style={styles.questionIconBadgeText}>?</Text>
          )}
        </View>
        <View style={styles.rowTextCol}>
          <Text style={styles.todoText}>{`Q: ${block.text ?? ""}`}</Text>
          {resolved ? (
            <Text style={styles.questionAnswerPreview}>{`A: ${answer}`}</Text>
          ) : null}
          <Text style={styles.cardSubMeta}>{block.sessionTitle || "無題のノート"}</Text>
          {!resolved ? (
            <TouchableOpacity
              hitSlop={8}
              style={styles.deferButton}
              onPress={() => toggleDeferred(block)}
            >
              <Text style={styles.deferButtonText}>
                {block.isDeferred ? "保留を解除する" : "保留にする"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity hitSlop={8} onPress={() => goToBlock(block)}>
          <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderStarredRow = (block: BlockWithSession) => {
    const summary = block.summaryNote?.trim();
    return (
      <TouchableOpacity
        key={block.id}
        style={styles.todoCard}
        activeOpacity={0.7}
        onPress={() => startStarEdit(block)}
        onLongPress={() => rowMenu.open(`star:${block.id}`, { kind: "star", block })}
        ref={rowMenu.registerRef(`star:${block.id}`)}
      >
        <View style={styles.rowTextCol}>
          <Text style={styles.todoText}>{summary || block.text || ""}</Text>
          <Text style={styles.cardSubMeta}>{block.sessionTitle || "無題のノート"}</Text>
        </View>
        <TouchableOpacity hitSlop={8} onPress={() => goToBlock(block)}>
          <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // ノートをまたいでユーザーが束ねた★グループを、1グループ=1カードで表示する。
  // グループ内の項目が全て同じノート由来なら共通のノート名を1行だけ添え、
  // 複数ノートにまたがる場合は行ごとにノート名を出す
  const renderStarredGroupCard = (name: string, items: BlockWithSession[]) => {
    const sameSession = items.every((b) => b.sessionId === items[0].sessionId);
    const groupKey = `star-group:${name}`;
    return (
      <View key={name} style={styles.groupCard} ref={rowMenu.registerRef(groupKey)}>
        <TouchableOpacity activeOpacity={0.6} onPress={() => startGroupPrompt(items[0])}>
          <Text style={styles.groupCardTitle} numberOfLines={1}>
            {name}
          </Text>
        </TouchableOpacity>
        {items.map((block) => {
          const summary = block.summaryNote?.trim();
          return (
            <TouchableOpacity
              key={block.id}
              style={styles.groupCardRow}
              activeOpacity={0.7}
              onPress={() => startStarEdit(block)}
              onLongPress={() => rowMenu.open(groupKey, { kind: "star", block, group: { name, items } })}
            >
              <View style={styles.rowTextCol}>
                <Text style={styles.todoText}>{summary || block.text || ""}</Text>
                {!sameSession ? (
                  <Text style={styles.cardSubMeta}>{block.sessionTitle || "無題のノート"}</Text>
                ) : null}
              </View>
              <TouchableOpacity hitSlop={8} onPress={() => goToBlock(block)}>
                <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
        {sameSession ? (
          <Text style={styles.cardSubMeta}>{items[0].sessionTitle || "無題のノート"}</Text>
        ) : null}
      </View>
    );
  };

  const unresolvedQuestions = questions.filter((q) => !q.questionTerm?.trim() && !q.isDeferred);
  const deferredQuestions = questions.filter((q) => !q.questionTerm?.trim() && q.isDeferred);
  const resolvedQuestions = questions.filter((q) => !!q.questionTerm?.trim());

  // ★をグループ名(importantGroup)ごとに束ねる。未分類は今まで通りフラットな一覧のまま
  const starredGroupOrder: string[] = [];
  const starredGroupMap = new Map<string, BlockWithSession[]>();
  const starredUngrouped: BlockWithSession[] = [];
  for (const block of starred) {
    const name = block.importantGroup?.trim();
    if (!name) {
      starredUngrouped.push(block);
      continue;
    }
    if (!starredGroupMap.has(name)) {
      starredGroupMap.set(name, []);
      starredGroupOrder.push(name);
    }
    starredGroupMap.get(name)!.push(block);
  }
  const starredGroups = starredGroupOrder.map((name) => ({ name, items: starredGroupMap.get(name)! }));

  const showTodoSection = tab === "all" || tab === "todo";
  const showQuestionSection = tab === "all" || tab === "question";
  const showStarSection = tab === "all" || tab === "star";

  // 検索中はToDo(未完了/完了)・質問(未解決/保留/解決済み)の区分をまたいで、
  // 発言テキスト・回答・一言メモ・ノートタイトルのいずれかに一致する行だけをフラットに表示する
  const trimmedQuery = query.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const matchesQuery = (block: BlockWithSession) =>
    (block.text ?? "").toLowerCase().includes(trimmedQuery) ||
    (block.questionTerm ?? "").toLowerCase().includes(trimmedQuery) ||
    (block.summaryNote ?? "").toLowerCase().includes(trimmedQuery) ||
    (block.sessionTitle ?? "").toLowerCase().includes(trimmedQuery) ||
    (block.importantGroup ?? "").toLowerCase().includes(trimmedQuery);

  // Todo/質問/★の件数が多い場合に、検索していない間や無関係な再レンダーのたびに
  // 毎回フィルタし直さないよう、検索語や対象データが変わった時だけ計算し直す
  const todoSearchResults = useMemo(
    () => (isSearching ? [...todos.pending, ...todos.done].filter(matchesQuery) : []),
    [isSearching, todos, trimmedQuery]
  );
  const questionSearchResults = useMemo(
    () => (isSearching ? questions.filter(matchesQuery) : []),
    [isSearching, questions, trimmedQuery]
  );
  const starSearchResults = useMemo(
    () => (isSearching ? starred.filter(matchesQuery) : []),
    [isSearching, starred, trimmedQuery]
  );

  const isEmptyForTab = isSearching
    ? (!showTodoSection || todoSearchResults.length === 0) &&
      (!showQuestionSection || questionSearchResults.length === 0) &&
      (!showStarSection || starSearchResults.length === 0)
    : (!showTodoSection || (todos.pending.length === 0 && todos.done.length === 0)) &&
      (!showQuestionSection || questions.length === 0) &&
      (!showStarSection || starred.length === 0);

  const rowMenuItems: RowMenuItem[] = !rowMenu.anchor
    ? []
    : rowMenu.anchor.data.kind === "todo"
    ? (() => {
        const block = rowMenu.anchor!.data.block;
        return [
          {
            key: "edit",
            label: "編集",
            icon: "create-outline",
            color: "#8e8e93",
            onPress: () => rowMenu.close(() => startTodoEdit(block)),
          },
          {
            key: "toggleDone",
            label: block.todoDone ? "未対応に戻す" : "完了にする",
            icon: "checkmark-done-outline",
            color: colors.todo.accent,
            onPress: () => rowMenu.close(() => toggleTodoDone(block)),
          },
          {
            key: "open",
            label: "ノートを開く",
            icon: "open-outline",
            color: "#06c",
            onPress: () => rowMenu.close(() => goToBlock(block)),
          },
        ];
      })()
    : rowMenu.anchor.data.kind === "question"
    ? (() => {
        const block = rowMenu.anchor!.data.block;
        return [
          {
            key: "answer",
            label: block.questionTerm?.trim() ? "回答を編集" : "回答を記入",
            icon: "chatbubble-ellipses-outline",
            color: "#7c4dff",
            onPress: () => rowMenu.close(() => startAnswerPrompt(block)),
          },
          {
            key: "defer",
            label: block.isDeferred ? "保留を解除する" : "保留にする",
            icon: "time-outline",
            color: colors.star.accent,
            onPress: () => rowMenu.close(() => toggleDeferred(block)),
          },
          {
            key: "open",
            label: "ノートを開く",
            icon: "open-outline",
            color: "#06c",
            onPress: () => rowMenu.close(() => goToBlock(block)),
          },
        ];
      })()
    : (() => {
        const block = rowMenu.anchor!.data.block;
        return [
          {
            key: "edit",
            label: "編集",
            icon: "create-outline",
            color: "#8e8e93",
            onPress: () => rowMenu.close(() => startStarEdit(block)),
          },
          {
            key: "group",
            label: block.importantGroup?.trim()
              ? `グループ: ${block.importantGroup}`
              : "グループを設定",
            icon: "albums-outline",
            color: colors.star.accent,
            onPress: () => rowMenu.close(() => startGroupPrompt(block)),
          },
          {
            key: "open",
            label: "ノートを開く",
            icon: "open-outline",
            color: "#06c",
            onPress: () => rowMenu.close(() => goToBlock(block)),
          },
        ];
      })();

  // ToDo系の行だけ、元のNotesScreen/NoteDetailScreenと同じ左端の緑アクセントバーを添える
  const rowMenuAccentBarColor = rowMenu.anchor?.data.kind === "todo" ? "#34C759" : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>まとめ</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8e8e93" />
        <TextInput
          style={styles.searchInput}
          placeholder="ToDo・質問・重要を検索"
          placeholderTextColor="#8e8e93"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabButton, tab === t.key && styles.tabButtonSelected]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabButtonText, tab === t.key && styles.tabButtonTextSelected]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content}>
        {isEmptyForTab ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {isSearching
                ? "検索結果がありません"
                : "★・📝・❓を記録すると、ここにまとまって表示されます"}
            </Text>
          </View>
        ) : (
          <>
            {showStarSection && (isSearching ? starSearchResults.length > 0 : starred.length > 0) ? (
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.sectionHeaderRow}
                  onPress={() => toggleSection("star")}
                >
                  <View style={[styles.sectionPill, styles.sectionPillStar]}>
                    <Text style={[styles.sectionPillText, styles.sectionPillTextStar]}>★ 重要</Text>
                  </View>
                  <Text style={styles.sectionCount}>
                    {isSearching ? starSearchResults.length : starred.length}件
                  </Text>
                  <Ionicons
                    name={collapsedSections.has("star") ? "chevron-forward" : "chevron-down"}
                    size={18}
                    color="#8e8e93"
                    style={styles.sectionChevron}
                  />
                </TouchableOpacity>
                {!collapsedSections.has("star") ? (
                  isSearching ? (
                    starSearchResults.map(renderStarredRow)
                  ) : (
                    <>
                      {starredGroups.map((g) => renderStarredGroupCard(g.name, g.items))}
                      {starredUngrouped.map(renderStarredRow)}
                    </>
                  )
                ) : null}
              </View>
            ) : null}

            {showTodoSection ? (
            <View style={styles.section}>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.sectionHeaderRow}
                onPress={() => toggleSection("todo")}
              >
                <View style={[styles.sectionPill, styles.sectionPillTodo]}>
                  <Text style={[styles.sectionPillText, styles.sectionPillTextTodo]}>✓ Todo</Text>
                </View>
                <Text style={styles.sectionCount}>
                  {isSearching ? todoSearchResults.length : todos.pending.length}件
                </Text>
                <Ionicons
                  name={collapsedSections.has("todo") ? "chevron-forward" : "chevron-down"}
                  size={18}
                  color="#8e8e93"
                  style={styles.sectionChevron}
                />
              </TouchableOpacity>
              {!collapsedSections.has("todo") ? (
              isSearching ? (
                todoSearchResults.length === 0 ? (
                  <Text style={styles.emptyGroupText}>一致するToDoはありません</Text>
                ) : (
                  todoSearchResults.map(renderTodoRow)
                )
              ) : (
                <>
                  {todos.pending.length === 0 ? (
                    <Text style={styles.emptyGroupText}>未完了のToDoはありません</Text>
                  ) : (
                    todos.pending.map(renderTodoRow)
                  )}
                  <TouchableOpacity onPress={() => setShowDoneTodos((v) => !v)}>
                    <Text style={styles.expandToggleText}>
                      {showDoneTodos ? "完了済みを閉じる ▲" : "完了したものも見る ▼"}
                    </Text>
                  </TouchableOpacity>
                  {showDoneTodos ? (
                    <View style={styles.expandedGroup}>
                      <View style={[styles.statusHeaderPill, styles.statusPillDone]}>
                        <Text style={[styles.statusHeaderPillText, styles.statusPillTextDone]}>
                          完了 {todos.done.length}件
                        </Text>
                      </View>
                      {todos.done.length === 0 ? (
                        <Text style={styles.emptyGroupText}>なし</Text>
                      ) : (
                        todos.done.map(renderTodoRow)
                      )}
                    </View>
                  ) : null}
                </>
              )
              ) : null}
            </View>
            ) : null}

            {showQuestionSection ? (
            <View style={styles.section}>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.sectionHeaderRow}
                onPress={() => toggleSection("question")}
              >
                <View style={[styles.sectionPill, styles.sectionPillQuestion]}>
                  <Text style={[styles.sectionPillText, styles.sectionPillTextQuestion]}>? 質問</Text>
                </View>
                <Text style={styles.sectionCount}>
                  {isSearching ? questionSearchResults.length : unresolvedQuestions.length}件
                </Text>
                <Ionicons
                  name={collapsedSections.has("question") ? "chevron-forward" : "chevron-down"}
                  size={18}
                  color="#8e8e93"
                  style={styles.sectionChevron}
                />
              </TouchableOpacity>
              {!collapsedSections.has("question") ? (
              isSearching ? (
                questionSearchResults.length === 0 ? (
                  <Text style={styles.emptyGroupText}>一致する質問はありません</Text>
                ) : (
                  questionSearchResults.map(renderQuestionRow)
                )
              ) : (
                <>
                  {unresolvedQuestions.length === 0 ? (
                    <Text style={styles.emptyGroupText}>未解決の質問はありません</Text>
                  ) : (
                    unresolvedQuestions.map(renderQuestionRow)
                  )}
                  <TouchableOpacity onPress={() => setShowMoreQuestions((v) => !v)}>
                    <Text style={styles.expandToggleText}>
                      {showMoreQuestions ? "閉じる ▲" : "解決済み・保留も見る ▼"}
                    </Text>
                  </TouchableOpacity>
                  {showMoreQuestions ? (
                    <View style={styles.expandedGroup}>
                      <View style={[styles.statusHeaderPill, styles.statusPillDeferred]}>
                        <Text style={[styles.statusHeaderPillText, styles.statusPillTextDeferred]}>
                          保留 {deferredQuestions.length}件
                        </Text>
                      </View>
                      {deferredQuestions.length === 0 ? (
                        <Text style={styles.emptyGroupText}>なし</Text>
                      ) : (
                        deferredQuestions.map(renderQuestionRow)
                      )}
                      <View
                        style={[styles.statusHeaderPill, styles.statusPillDone, styles.statusHeaderPillSpaced]}
                      >
                        <Text style={[styles.statusHeaderPillText, styles.statusPillTextDone]}>
                          解決済み {resolvedQuestions.length}件
                        </Text>
                      </View>
                      {resolvedQuestions.length === 0 ? (
                        <Text style={styles.emptyGroupText}>なし</Text>
                      ) : (
                        resolvedQuestions.map(renderQuestionRow)
                      )}
                    </View>
                  ) : null}
                </>
              )
              ) : null}
            </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {!isSearching && (tab === "todo" || tab === "question") ? (
        <TouchableOpacity
          style={[styles.fab, tab === "question" && styles.fabQuestion]}
          activeOpacity={0.8}
          onPress={() => startQuickAdd(tab)}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <EditCardModal visible={todoEditVisible} onCancel={cancelTodoEdit}>
        <InlineEditCard
          kind="todo"
          title="ToDoを編集"
          subtitle={todoEditSubtitle}
          value={todoEditDraft}
          onChangeText={setTodoEditDraft}
          placeholder="ToDoの内容"
          caption="必須"
          onCancel={cancelTodoEdit}
          onConfirm={confirmTodoEdit}
        />
      </EditCardModal>

      <EditCardModal visible={answerPromptVisible} onCancel={cancelAnswerPrompt}>
        <InlineEditCard
          kind="question"
          title="質問を編集"
          subtitle={answerPromptSubtitle}
          value={answerPromptQDraft}
          onChangeText={setAnswerPromptQDraft}
          placeholder="質問の内容"
          caption="Q ・ 必須"
          showSecondary
          secondaryValue={answerPromptDraft}
          onSecondaryChange={setAnswerPromptDraft}
          secondaryPlaceholder="わかったこと・聞いた答えなど"
          secondaryCaption="A ・ 任意"
          onCancel={cancelAnswerPrompt}
          onConfirm={confirmAnswerPrompt}
        />
      </EditCardModal>

      <EditCardModal visible={starEditVisible} onCancel={cancelStarEdit}>
        <InlineEditCard
          kind="star"
          title="一言メモを編集"
          subtitle={starEditSubtitle}
          value={starEditDraft}
          onChangeText={setStarEditDraft}
          placeholder="一言でまとめる(例: パスワードを使い回さない)"
          caption="空にすると元の発言テキストがそのまま表示されます"
          onCancel={cancelStarEdit}
          onConfirm={confirmStarEdit}
        />
      </EditCardModal>

      <EditCardModal visible={quickAddVisible} onCancel={cancelQuickAdd}>
        <InlineEditCard
          kind={quickAddKind}
          title={quickAddKind === "todo" ? "ToDoを追加" : "質問を追加"}
          subtitle="クイック追加"
          value={quickAddDraft}
          onChangeText={setQuickAddDraft}
          placeholder={quickAddKind === "todo" ? "ToDoの内容" : "質問の内容"}
          caption={quickAddKind === "todo" ? "必須" : "Q ・ 必須"}
          showSecondary={quickAddKind === "question"}
          secondaryValue={quickAddAnswerDraft}
          onSecondaryChange={setQuickAddAnswerDraft}
          secondaryPlaceholder="わかったこと・聞いた答えなど"
          secondaryCaption="A ・ 任意・あとで記入してもOK"
          onCancel={cancelQuickAdd}
          onConfirm={confirmQuickAdd}
        />
      </EditCardModal>

      <Modal visible={groupPromptVisible} animationType="fade" transparent onRequestClose={cancelGroupPrompt}>
        <KeyboardAvoidingView
          style={styles.itemFormKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.quickAddOverlay} onPress={cancelGroupPrompt}>
            <Pressable style={styles.groupSettingPanel} onPress={(e) => e.stopPropagation()}>
              <GroupSettingForm
                value={groupPromptDraft}
                onChangeText={setGroupPromptDraft}
                existingGroups={groupPromptExisting}
                onCancel={cancelGroupPrompt}
                onConfirm={confirmGroupPrompt}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <RowLongPressMenu
        anchor={rowMenu.anchor}
        scale={rowMenu.scale}
        items={rowMenuItems}
        onClose={() => rowMenu.close()}
        accentBarColor={rowMenuAccentBarColor}
        renderPreview={(data: RowMenuData) =>
          data.kind === "question" ? (
            <View>
              <Text style={styles.rowMenuPreviewText} numberOfLines={4}>{`Q: ${data.block.text ?? ""}`}</Text>
              {data.block.questionTerm?.trim() ? (
                <Text style={styles.questionAnswerPreview} numberOfLines={4}>
                  {`A: ${data.block.questionTerm}`}
                </Text>
              ) : null}
              <Text style={styles.cardSubMeta}>{data.block.sessionTitle || "無題のノート"}</Text>
            </View>
          ) : data.kind === "star" && data.group ? (
            (() => {
              const items = data.group.items;
              const sameSession = items.every((b) => b.sessionId === items[0].sessionId);
              return (
                <View>
                  <Text style={styles.groupCardTitle} numberOfLines={1}>
                    {data.group.name}
                  </Text>
                  {items.map((b) => (
                    <View key={b.id}>
                      <Text style={styles.rowMenuPreviewText}>{b.summaryNote?.trim() || b.text || ""}</Text>
                      {!sameSession ? (
                        <Text style={styles.cardSubMeta}>{b.sessionTitle || "無題のノート"}</Text>
                      ) : null}
                    </View>
                  ))}
                  {sameSession ? (
                    <Text style={styles.cardSubMeta}>{items[0].sessionTitle || "無題のノート"}</Text>
                  ) : null}
                </View>
              );
            })()
          ) : data.kind === "star" ? (
            <View>
              <Text style={styles.rowMenuPreviewText} numberOfLines={4}>
                {data.block.summaryNote?.trim() || data.block.text || ""}
              </Text>
              <Text style={styles.cardSubMeta}>{data.block.sessionTitle || "無題のノート"}</Text>
            </View>
          ) : (
            <View>
              <Text style={styles.rowMenuPreviewText} numberOfLines={4}>
                {data.block.text ?? ""}
              </Text>
              <Text style={styles.cardSubMeta}>{data.block.sessionTitle || "無題のノート"}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: fontSize.tabTitle, fontWeight: "700", color: "#1c1c1e" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.searchBarBackground,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  searchInput: { flex: 1, fontSize: 15, color: "#1c1c1e" },

  tabRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.searchBarBackground,
    borderRadius: 10,
    padding: 2,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  tabButtonSelected: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabButtonText: { fontSize: 13, color: "#3c3c43", fontWeight: "600" },
  tabButtonTextSelected: { color: "#1c1c1e" },

  content: { flex: 1, marginTop: 4 },

  section: { marginBottom: 8 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  sectionPillText: { fontSize: 13, fontWeight: "700" },
  sectionPillStar: { backgroundColor: colors.star.background },
  sectionPillTextStar: { color: colors.star.accent },
  sectionPillTodo: { backgroundColor: colors.todo.background },
  sectionPillTextTodo: { color: colors.todo.accent },
  sectionPillQuestion: { backgroundColor: colors.question.background },
  sectionPillTextQuestion: { color: colors.question.accent },
  sectionCount: { fontSize: 13, color: "#8e8e93", marginLeft: 8 },
  sectionChevron: { marginLeft: "auto" },

  // Todo/質問タブでのみ表示するクイック追加FAB
  fab: {
    position: "absolute",
    left: 20,
    bottom: 24,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.todo.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  fabQuestion: { backgroundColor: colors.question.accent },

  // 行の長押しメニューのゴーストカードに表示するプレビュー文
  rowMenuPreviewText: { fontSize: 15, color: "#1c1c1e" },

  emptyGroupText: {
    fontSize: 13,
    color: "#c7c7cc",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  expandToggleText: {
    fontSize: 13,
    color: "#06c",
    fontWeight: "600",
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 4,
  },
  expandedGroup: { marginTop: 4 },

  // ToDo/質問の区分見出し(パステルピル+件数)。ノートタブの質問タブから移設
  statusHeaderPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  statusHeaderPillSpaced: { marginTop: 12 },
  statusHeaderPillText: { fontSize: 13, fontWeight: "700" },
  statusPillDone: { backgroundColor: "#e5e5ea" },
  statusPillTextDone: { color: "#636366" },
  statusPillDeferred: { backgroundColor: colors.star.background },
  statusPillTextDeferred: { color: colors.star.accent },

  // ToDo/質問カード(ノートタブのToDo/質問タブから移設した見た目)
  rowTextCol: { flex: 1 },
  todoCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: radius.card,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: spacing.cardPadding,
    paddingVertical: spacing.cardPadding,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  todoText: { flex: 1, fontSize: fontSize.body, color: "#1c1c1e" },
  todoTextDone: { color: "#8e8e93", textDecorationLine: "line-through" },

  // ユーザーが束ねた★グループ(importantGroup)のカード。1グループ=1カードにまとめる
  groupCard: {
    backgroundColor: "#fff",
    borderRadius: radius.card,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: spacing.cardPadding,
    paddingTop: spacing.cardPadding,
    paddingBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  groupCardTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: "700",
    color: "#1c1c1e",
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  groupCardRow: { flexDirection: "row", alignItems: "center", paddingBottom: 8 },
  cardSubMeta: { fontSize: 12, color: "#8e8e93", marginTop: 3 },
  questionAnswerPreview: { fontSize: 12, color: colors.todo.accent, marginTop: 3 },
  questionIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  questionIconBadgeOpen: { backgroundColor: colors.question.background },
  questionIconBadgeResolved: { backgroundColor: colors.todo.background },
  questionIconBadgeText: { fontSize: 15, fontWeight: "700", color: colors.question.accent },
  deferButton: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#ebebf0",
  },
  deferButtonText: { fontSize: 12, fontWeight: "600", color: "#3c3c43" },

  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 8,
  },
  placeholderText: { color: "#8e8e93", fontSize: 14, textAlign: "center" },

  // クイック追加/ToDo編集/質問編集の共通モーダル外枠(ノートタブから移設)
  itemFormKeyboardAvoider: { flex: 1, justifyContent: "flex-end" },
  quickAddOverlay: {
    flex: 1,
    backgroundColor: colors.overlay.card,
    justifyContent: "center",
    alignItems: "center",
  },
  // InlineEditCard/GroupSettingForm自体がカードの背景・パディング・影を持つので、
  // ここでは幅だけ制約する
  editCardPanel: { width: "85%" },
  groupSettingPanel: { width: "88%", maxWidth: 420 },
});
