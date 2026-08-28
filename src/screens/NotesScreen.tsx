import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
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
import * as audioFilesRepo from "../db/repositories/audioFiles";
import type { BlockWithSession, MonthGroup, SearchResult, Session } from "../db/types";
import { deleteStoredFile } from "../utils/files";

type DisplayMode = "list" | "calendar" | "todo" | "question";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "list", label: "リスト" },
  { key: "calendar", label: "カレンダー" },
  { key: "todo", label: "ToDo" },
  { key: "question", label: "質問" },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

type SessionSummary = Session & {
  starCount: number;
  todoCount: number;
  questionCount: number;
  photoCount: number;
  photoUri: string | null;
};

type DayGroup = {
  dateKey: string;
  monthKey: string;
  dayNum: number;
  items: SessionSummary[];
};

type HourGroup = { hour: number; items: SessionSummary[] };

type TodoGroups = { pending: BlockWithSession[]; done: BlockWithSession[] };

type SessionGroup = {
  sessionId: string;
  sessionTitle: string;
  sessionStartedAt: number;
  items: BlockWithSession[];
};

// 同じノートに属する行をまとめて、ノートごとの小見出しでグループ化する
// (出現順=一覧の並び順を保つ)
function groupBySession(blocks: BlockWithSession[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const indexBySession = new Map<string, number>();
  for (const block of blocks) {
    let idx = indexBySession.get(block.sessionId);
    if (idx === undefined) {
      idx = groups.length;
      indexBySession.set(block.sessionId, idx);
      groups.push({
        sessionId: block.sessionId,
        sessionTitle: block.sessionTitle,
        sessionStartedAt: block.sessionStartedAt,
        items: [],
      });
    }
    groups[idx].items.push(block);
  }
  return groups;
}

function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function formatTime(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60000);
  return `${totalMinutes}分`;
}

function formatDateSlash(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatDateShort(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function dayKeyOf(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function monthKeyOf(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const d = new Date(Number(yearStr), Number(monthStr) - 1 + delta, 1);
  return monthKeyOf(d.getTime());
}

function formatWeekdayLabel(dateKey: string): string {
  const [y, m, day] = dateKey.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  return WEEKDAYS[d.getDay()];
}

type CalendarCell = { dateKey: string; dayNum: number; inMonth: boolean };

function buildMonthGrid(monthKey: string): CalendarCell[] {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: CalendarCell[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const d = new Date(year, month - 1, dayNum);
    cells.push({ dateKey: dayKeyOf(d.getTime()), dayNum, inMonth: false });
  }
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const d = new Date(year, month, dayNum);
    cells.push({ dateKey: dayKeyOf(d.getTime()), dayNum, inMonth: true });
  }
  let trailDay = 1;
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month + 1, trailDay);
    cells.push({ dateKey: dayKeyOf(d.getTime()), dayNum: trailDay, inMonth: false });
    trailDay++;
  }
  return cells;
}

function noteDisplayTitle(session: Session): string {
  return session.title || `${formatDateSlash(session.startedAt)} の記録`;
}

export default function NotesScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mode, setMode] = useState<DisplayMode>("list");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [monthGroups, setMonthGroups] = useState<MonthGroup<SessionSummary>[]>([]);
  const [todos, setTodos] = useState<TodoGroups>({ pending: [], done: [] });
  // 「ToDo」タブの項目を長押しして開く、本文の編集(対象ブロックID)
  const [todoEditBlockId, setTodoEditBlockId] = useState<string | null>(null);
  const [todoEditDraft, setTodoEditDraft] = useState("");
  // ToDo/質問タブの「未対応/完了」「未解決/解決済み」区分の開閉状態
  // (ノート詳細画面のセクション折りたたみと同じ考え方)
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set());
  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // ❓は「わからなかったこと全般」を記録する単一の機能。is_question=1の全件を持つ
  const [questions, setQuestions] = useState<BlockWithSession[]>([]);
  // 「質問」タブの各項目をタップして開く、Q(発言テキスト)とA(回答メモ)の編集(対象ブロックID)
  const [answerPromptBlockId, setAnswerPromptBlockId] = useState<string | null>(null);
  const [answerPromptQDraft, setAnswerPromptQDraft] = useState("");
  const [answerPromptDraft, setAnswerPromptDraft] = useState("");
  const [calendarMonthKey, setCalendarMonthKey] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() => new Date().getFullYear());
  const calendarInitRef = useRef(false);

  const loadNotes = useCallback(async () => {
    try {
      const groups = await sessionsRepo.listAllGroupedByMonth();
      const summarized: MonthGroup<SessionSummary>[] = await Promise.all(
        groups.map(async (group) => ({
          monthKey: group.monthKey,
          items: await Promise.all(
            group.items.map(async (session) => {
              const blocks = await blocksRepo.listBySessionId(session.id);
              const photoBlocks = blocks.filter((b) => b.kind === "photo" && b.photoUri);
              return {
                ...session,
                starCount: blocks.filter((b) => b.isStarred).length,
                todoCount: blocks.filter((b) => b.isTodo).length,
                questionCount: blocks.filter((b) => b.isQuestion).length,
                photoCount: photoBlocks.length,
                photoUri: photoBlocks[0]?.photoUri ?? null,
              };
            })
          ),
        }))
      );
      setMonthGroups(summarized);
    } catch (e) {
      console.warn("[DB] ノート一覧の取得に失敗しました", e);
    }
  }, []);

  const loadTodos = useCallback(async () => {
    try {
      const groups = await blocksRepo.listAllTodos();
      setTodos(groups);
    } catch (e) {
      console.warn("[DB] Todo一覧の取得に失敗しました", e);
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    try {
      const rows = await blocksRepo.listAllQuestions();
      setQuestions(rows);
    } catch (e) {
      console.warn("[DB] 質問一覧の取得に失敗しました", e);
    }
  }, []);

  // 「質問」タブの項目をタップして開く、Q(発言テキスト)とA(回答メモ)の編集。
  // 既に内容があれば編集できるよう、その内容を初期値にする
  const startAnswerPrompt = (block: BlockWithSession) => {
    setAnswerPromptBlockId(block.id);
    setAnswerPromptQDraft(block.text ?? "");
    setAnswerPromptDraft(block.questionTerm ?? "");
  };

  const cancelAnswerPrompt = () => {
    setAnswerPromptBlockId(null);
    setAnswerPromptQDraft("");
    setAnswerPromptDraft("");
  };

  // Aを保存すると「解決済み」として扱われる(空にして保存すると未解決に戻る)。
  // Qが空のままだと発言そのものが消えてしまうため、その場合はQの変更を破棄する
  const confirmAnswerPrompt = async () => {
    const id = answerPromptBlockId;
    const question = answerPromptQDraft.trim();
    const answer = answerPromptDraft;
    setAnswerPromptBlockId(null);
    setAnswerPromptQDraft("");
    setAnswerPromptDraft("");
    if (!id) return;
    try {
      if (question) await blocksRepo.update(id, question);
      await blocksRepo.answerQuestion(id, answer);
      loadQuestions();
    } catch (e) {
      console.warn("[DB] 質問の保存に失敗しました", e);
    }
  };

  // ToDoタブの長押し編集。既存の本文を初期値にする
  const startTodoEdit = (block: BlockWithSession) => {
    setTodoEditBlockId(block.id);
    setTodoEditDraft(block.text ?? "");
  };

  const cancelTodoEdit = () => {
    setTodoEditBlockId(null);
    setTodoEditDraft("");
  };

  const confirmTodoEdit = async () => {
    const id = todoEditBlockId;
    const text = todoEditDraft.trim();
    setTodoEditBlockId(null);
    setTodoEditDraft("");
    if (!id || !text) return;
    try {
      await blocksRepo.update(id, text);
      loadTodos();
    } catch (e) {
      console.warn("[DB] ToDoの本文更新に失敗しました", e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadNotes();
      loadTodos();
      loadQuestions();
    }, [loadNotes, loadTodos, loadQuestions])
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    blocksRepo
      .search(trimmed)
      .then((rows) => {
        if (!cancelled) setSearchResults(rows);
      })
      .catch((e) => console.warn("[DB] 検索に失敗しました", e));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const dayGroups = useMemo<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    const indexByDay = new Map<string, number>();
    for (const monthGroup of monthGroups) {
      for (const session of monthGroup.items) {
        const dateKey = dayKeyOf(session.startedAt);
        let idx = indexByDay.get(dateKey);
        if (idx === undefined) {
          const d = new Date(session.startedAt);
          idx = groups.length;
          indexByDay.set(dateKey, idx);
          groups.push({
            dateKey,
            monthKey: monthGroup.monthKey,
            dayNum: d.getDate(),
            items: [],
          });
        }
        groups[idx].items.push(session);
      }
    }
    return groups;
  }, [monthGroups]);

  const dayGroupsByKey = useMemo(() => {
    const map = new Map<string, DayGroup>();
    for (const group of dayGroups) map.set(group.dateKey, group);
    return map;
  }, [dayGroups]);

  // 初回データ取得時のみ、直近の記録がある月・日をデフォルトで開く
  useEffect(() => {
    if (calendarInitRef.current || dayGroups.length === 0) return;
    calendarInitRef.current = true;
    setCalendarMonthKey(dayGroups[0].monthKey);
    setSelectedDateKey(dayGroups[0].dateKey);
  }, [dayGroups]);

  const displayMonthKey = calendarMonthKey ?? monthKeyOf(Date.now());
  const monthGrid = useMemo(() => buildMonthGrid(displayMonthKey), [displayMonthKey]);

  // ピッカーを開くたびに、いま表示中の月の年から始める
  useEffect(() => {
    if (monthPickerVisible) {
      setMonthPickerYear(Number(displayMonthKey.split("-")[0]));
    }
  }, [monthPickerVisible, displayMonthKey]);

  const monthKeysWithData = useMemo(
    () => new Set(monthGroups.map((g) => g.monthKey)),
    [monthGroups]
  );
  const currentRealMonthKey = monthKeyOf(Date.now());
  const selectedDayGroup = selectedDateKey ? dayGroupsByKey.get(selectedDateKey) ?? null : null;

  // 選択日のセッションを開始時刻の「時」単位でまとめる(1時間ごとの区切り)
  const selectedHourGroups = useMemo<HourGroup[]>(() => {
    if (!selectedDayGroup) return [];
    const sorted = [...selectedDayGroup.items].sort((a, b) => a.startedAt - b.startedAt);
    const groups: HourGroup[] = [];
    const indexByHour = new Map<number, number>();
    for (const session of sorted) {
      const hour = new Date(session.startedAt).getHours();
      let idx = indexByHour.get(hour);
      if (idx === undefined) {
        idx = groups.length;
        indexByHour.set(hour, idx);
        groups.push({ hour, items: [] });
      }
      groups[idx].items.push(session);
    }
    return groups;
  }, [selectedDayGroup]);

  const isSearching = query.trim().length > 0;
  // 「質問」タブ: 回答メモ(question_term)が付いているかどうかで未解決/解決済みに分ける
  const unresolvedQuestions = questions.filter((q) => !q.questionTerm?.trim());
  const resolvedQuestions = questions.filter((q) => !!q.questionTerm?.trim());

  const goToNote = (noteId: string) => {
    navigation.navigate("NoteDetail", { noteId });
  };

  const goToBlock = (block: BlockWithSession | SearchResult) => {
    navigation.navigate("NoteDetail", { noteId: block.sessionId, jumpToBlockId: block.id });
  };

  // ノートを削除する。blocks/audio_filesはON DELETE CASCADEでDB側は消えるが、
  // 実ファイル(写真・音声)はセッション削除前に一覧を取っておいて別途削除する
  const confirmDeleteSession = (session: SessionSummary) => {
    Alert.alert("このノートを削除しますか？", "録音・写真・メモなど全て削除され、元に戻せません。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            const [blocks, audioFiles] = await Promise.all([
              blocksRepo.listBySessionId(session.id),
              audioFilesRepo.listBySessionId(session.id),
            ]);
            await sessionsRepo.deleteById(session.id);
            await Promise.all([
              ...blocks
                .filter((b) => b.kind === "photo" && b.photoUri)
                .map((b) => deleteStoredFile(b.photoUri as string)),
              ...audioFiles.map((f) => deleteStoredFile(f.fileUri)),
            ]);
            loadNotes();
            loadTodos();
            loadQuestions();
          } catch (e) {
            console.warn("[DB] ノートの削除に失敗しました", e);
          }
        },
      },
    ]);
  };

  const renderCard = (session: SessionSummary, compact = false) => {
    const thumbBadge =
      session.photoCount > 1
        ? `+${session.photoCount - 1}枚`
        : session.photoCount === 1
        ? "1枚"
        : null;

    return (
      <TouchableOpacity
        key={session.id}
        style={[styles.card, compact && styles.cardNoMargin]}
        activeOpacity={0.7}
        onPress={() => goToNote(session.id)}
        onLongPress={() => confirmDeleteSession(session)}
      >
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {noteDisplayTitle(session)}
          </Text>
          <Text style={styles.cardMeta}>
            {formatTime(session.startedAt)} 開始 ・ {formatDuration(session.durationMs)}
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, styles.badgeStar]}>
              <Text style={styles.badgeStarIcon}>★</Text>
              <Text style={styles.badgeStarText}>{session.starCount}</Text>
            </View>
            <View style={[styles.badge, styles.badgeTodo]}>
              <Text style={styles.badgeTodoIcon}>✓</Text>
              <Text style={styles.badgeTodoText}>{session.todoCount}</Text>
            </View>
            <View style={[styles.badge, styles.badgeQuestion]}>
              <Text style={styles.badgeQuestionIcon}>?</Text>
              <Text style={styles.badgeQuestionText}>{session.questionCount}</Text>
            </View>
          </View>
        </View>
        <View style={styles.thumbWrap}>
          {session.photoUri ? (
            <Image source={{ uri: session.photoUri }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="camera-outline" size={20} color="#c7c7cc" />
            </View>
          )}
          {thumbBadge ? (
            <View style={styles.thumbBadge}>
              <Text style={styles.thumbBadgeText}>{thumbBadge}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderTodoRow = (block: BlockWithSession) => (
    <TouchableOpacity
      key={block.id}
      style={styles.todoCard}
      activeOpacity={0.7}
      onPress={() => goToBlock(block)}
      onLongPress={() => startTodoEdit(block)}
    >
      <TouchableOpacity
        hitSlop={8}
        onPress={() => blocksRepo.toggleTodoDone(block.id).then(loadTodos)}
      >
        <Ionicons
          name={block.todoDone ? "checkmark-circle" : "ellipse-outline"}
          size={24}
          color={block.todoDone ? "#34c759" : "#c7c7cc"}
        />
      </TouchableOpacity>
      <Text
        style={[styles.todoText, block.todoDone && styles.todoTextDone]}
        numberOfLines={2}
      >
        {block.text}
      </Text>
      <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
    </TouchableOpacity>
  );

  // 「質問」タブの行。ToDoタブと同じ「ノートごとの小見出し+カード」パターン。
  // 行タップ=回答(A)の入力を開く(このタブの主目的)、右端の矢印タップ=該当ノートへ遷移
  // (独立したタップ領域)。回答が付けば「解決済み」。Q(発言テキスト)のみ/Q+A
  // (question_termを回答として転用)の2パターンを表示する
  const renderQuestionRow = (block: BlockWithSession) => {
    const answer = block.questionTerm?.trim();
    const resolved = !!answer;
    return (
      <TouchableOpacity
        key={block.id}
        style={styles.todoCard}
        activeOpacity={0.7}
        onPress={() => startAnswerPrompt(block)}
      >
        <Ionicons
          name={resolved ? "checkmark-circle" : "help-circle-outline"}
          size={22}
          color={resolved ? "#34c759" : "#7c4dff"}
        />
        <View style={styles.questionTextCol}>
          <Text style={styles.todoText} numberOfLines={2}>
            Q: {block.text}
          </Text>
          {resolved ? (
            <Text style={styles.questionAnswerPreview} numberOfLines={2}>
              A: {answer}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity hitSlop={8} onPress={() => goToBlock(block)}>
          <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderNoteGroupHeader = (group: { sessionTitle: string; sessionStartedAt: number }) => (
    <Text style={styles.noteGroupHeader}>
      {group.sessionTitle || "無題のノート"} ・ {formatDateSlash(group.sessionStartedAt)}
    </Text>
  );

  const renderSearchRow = (result: SearchResult) => (
    <TouchableOpacity
      key={result.id}
      style={styles.searchRow}
      activeOpacity={0.7}
      onPress={() => goToBlock(result)}
    >
      <Text style={styles.searchMeta}>
        {result.sessionTitle || "無題のノート"} ・ {formatDateShort(result.sessionStartedAt)}
      </Text>
      <Text style={styles.searchSnippet}>{result.snippet}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 検索バー */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8e8e93" />
        <TextInput
          style={styles.searchInput}
          placeholder="ノートを検索"
          placeholderTextColor="#8e8e93"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {/* セグメントコントロール */}
      <View style={styles.segmentedControl}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[
              styles.segment,
              mode === m.key && styles.segmentSelected,
            ]}
            onPress={() => setMode(m.key)}
          >
            <Text
              style={[
                styles.segmentText,
                mode === m.key && styles.segmentTextSelected,
              ]}
            >
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content}>
        {isSearching ? (
          <View>
            {searchResults.length === 0 ? (
              <View style={styles.placeholder}>
                <Ionicons name="search-outline" size={32} color="#c7c7cc" />
                <Text style={styles.placeholderText}>検索結果がありません</Text>
              </View>
            ) : (
              searchResults.map(renderSearchRow)
            )}
          </View>
        ) : (
          <>
            {mode === "list" && (
              <View>
                {monthGroups.length === 0 ? (
                  <View style={styles.placeholder}>
                    <Ionicons name="document-text-outline" size={32} color="#c7c7cc" />
                    <Text style={styles.placeholderText}>まだ記録がありません</Text>
                  </View>
                ) : (
                  monthGroups.map((group) => (
                    <View key={group.monthKey}>
                      <Text style={styles.sectionHeader}>{formatMonthKey(group.monthKey)}</Text>
                      {group.items.map((session) => renderCard(session))}
                    </View>
                  ))
                )}
              </View>
            )}

            {mode === "calendar" && (
              <View>
                <View style={styles.calHeader}>
                  <TouchableOpacity
                    style={styles.calNavButton}
                    onPress={() => setCalendarMonthKey(shiftMonthKey(displayMonthKey, -1))}
                  >
                    <Ionicons name="chevron-back" size={20} color="#3c3c43" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.calHeaderTitleButton}
                    activeOpacity={0.6}
                    onPress={() => setMonthPickerVisible(true)}
                  >
                    <Text style={styles.calHeaderTitle}>{formatMonthKey(displayMonthKey)}</Text>
                    <Ionicons name="chevron-down" size={14} color="#06c" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.calNavButton}
                    onPress={() => setCalendarMonthKey(shiftMonthKey(displayMonthKey, 1))}
                  >
                    <Ionicons name="chevron-forward" size={20} color="#3c3c43" />
                  </TouchableOpacity>
                </View>

                <View style={styles.calWeekdayRow}>
                  {WEEKDAYS.map((w) => (
                    <View key={w} style={styles.calCell}>
                      <Text style={styles.calWeekdayText}>{w}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.calGrid}>
                  {monthGrid.map((cell) => {
                    const hasNotes = dayGroupsByKey.has(cell.dateKey);
                    const isSelected = cell.dateKey === selectedDateKey;
                    return (
                      <TouchableOpacity
                        key={cell.dateKey}
                        style={styles.calCell}
                        activeOpacity={0.6}
                        onPress={() => setSelectedDateKey(cell.dateKey)}
                      >
                        <View style={[styles.calCellCircle, isSelected && styles.calCellCircleSelected]}>
                          <Text
                            style={[
                              styles.calCellText,
                              !cell.inMonth && styles.calCellTextDim,
                              isSelected && styles.calCellTextSelected,
                            ]}
                          >
                            {cell.dayNum}
                          </Text>
                        </View>
                        <View
                          style={[styles.calCellDot, hasNotes ? styles.calCellDotVisible : null]}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.calSelectedSection}>
                  <Text style={styles.sectionHeader}>
                    {selectedDateKey
                      ? `${Number(selectedDateKey.split("-")[1])}月${Number(
                          selectedDateKey.split("-")[2]
                        )}日(${formatWeekdayLabel(selectedDateKey)})`
                      : "日付を選択してください"}
                  </Text>
                  {selectedDateKey && !selectedDayGroup ? (
                    <View style={styles.placeholder}>
                      <Ionicons name="document-text-outline" size={32} color="#c7c7cc" />
                      <Text style={styles.placeholderText}>この日の記録はありません</Text>
                    </View>
                  ) : (
                    selectedHourGroups.map((hg, idx) => (
                      <View key={hg.hour} style={styles.timeRow}>
                        <View style={styles.timeBadgeCol}>
                          <View style={styles.timeBadge}>
                            <Text style={styles.timeBadgeText}>{hg.hour}時</Text>
                          </View>
                          {idx < selectedHourGroups.length - 1 ? (
                            <View style={styles.timeConnector} />
                          ) : null}
                        </View>
                        <View style={styles.timeCardWrap}>
                          {hg.items.map((session) => renderCard(session, true))}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>
            )}

            {mode === "todo" && (
              <View>
                {todos.pending.length === 0 && todos.done.length === 0 ? (
                  <View style={styles.placeholder}>
                    <Ionicons name="checkbox-outline" size={32} color="#c7c7cc" />
                    <Text style={styles.placeholderText}>Todoはまだありません</Text>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.sectionHeaderRow}
                      activeOpacity={0.6}
                      onPress={() => toggleGroupCollapsed("todo-pending")}
                    >
                      <Text style={styles.sectionHeader}>
                        {collapsedGroupKeys.has("todo-pending") ? "▶" : "▼"} 未対応 ・ {todos.pending.length}件
                      </Text>
                    </TouchableOpacity>
                    {collapsedGroupKeys.has("todo-pending") ? null : todos.pending.length === 0 ? (
                      <Text style={styles.emptyGroupText}>なし</Text>
                    ) : (
                      groupBySession(todos.pending).map((group) => (
                        <View key={group.sessionId}>
                          {renderNoteGroupHeader(group)}
                          {group.items.map(renderTodoRow)}
                        </View>
                      ))
                    )}
                    <TouchableOpacity
                      style={styles.sectionHeaderRow}
                      activeOpacity={0.6}
                      onPress={() => toggleGroupCollapsed("todo-done")}
                    >
                      <Text style={styles.sectionHeader}>
                        {collapsedGroupKeys.has("todo-done") ? "▶" : "▼"} 完了 ・ {todos.done.length}件
                      </Text>
                    </TouchableOpacity>
                    {collapsedGroupKeys.has("todo-done") ? null : todos.done.length === 0 ? (
                      <Text style={styles.emptyGroupText}>なし</Text>
                    ) : (
                      groupBySession(todos.done).map((group) => (
                        <View key={group.sessionId}>
                          {renderNoteGroupHeader(group)}
                          {group.items.map(renderTodoRow)}
                        </View>
                      ))
                    )}
                  </>
                )}
              </View>
            )}

            {mode === "question" && (
              <View>
                {questions.length === 0 ? (
                  <View style={styles.placeholder}>
                    <Ionicons name="help-circle-outline" size={32} color="#c7c7cc" />
                    <Text style={styles.placeholderText}>質問はまだありません</Text>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.sectionHeaderRow}
                      activeOpacity={0.6}
                      onPress={() => toggleGroupCollapsed("question-unresolved")}
                    >
                      <Text style={styles.sectionHeader}>
                        {collapsedGroupKeys.has("question-unresolved") ? "▶" : "▼"} 未解決 ・{" "}
                        {unresolvedQuestions.length}件
                      </Text>
                    </TouchableOpacity>
                    {collapsedGroupKeys.has("question-unresolved") ? null : unresolvedQuestions.length ===
                      0 ? (
                      <Text style={styles.emptyGroupText}>なし</Text>
                    ) : (
                      groupBySession(unresolvedQuestions).map((group) => (
                        <View key={group.sessionId}>
                          {renderNoteGroupHeader(group)}
                          {group.items.map(renderQuestionRow)}
                        </View>
                      ))
                    )}
                    <TouchableOpacity
                      style={styles.sectionHeaderRow}
                      activeOpacity={0.6}
                      onPress={() => toggleGroupCollapsed("question-resolved")}
                    >
                      <Text style={styles.sectionHeader}>
                        {collapsedGroupKeys.has("question-resolved") ? "▶" : "▼"} 解決済み ・{" "}
                        {resolvedQuestions.length}件
                      </Text>
                    </TouchableOpacity>
                    {collapsedGroupKeys.has("question-resolved") ? null : resolvedQuestions.length === 0 ? (
                      <Text style={styles.emptyGroupText}>なし</Text>
                    ) : (
                      groupBySession(resolvedQuestions).map((group) => (
                        <View key={group.sessionId}>
                          {renderNoteGroupHeader(group)}
                          {group.items.map(renderQuestionRow)}
                        </View>
                      ))
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={answerPromptBlockId !== null}
        animationType="fade"
        transparent
        onRequestClose={cancelAnswerPrompt}
      >
        <KeyboardAvoidingView
          style={styles.answerPromptKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.monthPickerOverlay} onPress={cancelAnswerPrompt}>
            <Pressable style={styles.answerPromptPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.answerPromptLabel}>Q</Text>
              <TextInput
                style={styles.answerPromptInput}
                value={answerPromptQDraft}
                onChangeText={setAnswerPromptQDraft}
                placeholder="質問の内容"
                multiline
              />
              <Text style={styles.answerPromptLabel}>A</Text>
              <TextInput
                style={styles.answerPromptInput}
                value={answerPromptDraft}
                onChangeText={setAnswerPromptDraft}
                placeholder="わかったこと・聞いた答えなどを書き足す"
                multiline
                autoFocus
              />
              <View style={styles.answerPromptButtonRow}>
                <TouchableOpacity style={styles.answerPromptButton} onPress={cancelAnswerPrompt}>
                  <Text style={styles.answerPromptButtonText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.answerPromptButton, styles.answerPromptButtonPrimary]}
                  onPress={confirmAnswerPrompt}
                >
                  <Text style={styles.answerPromptButtonPrimaryText}>保存</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={todoEditBlockId !== null}
        animationType="fade"
        transparent
        onRequestClose={cancelTodoEdit}
      >
        <KeyboardAvoidingView
          style={styles.answerPromptKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.monthPickerOverlay} onPress={cancelTodoEdit}>
            <Pressable style={styles.answerPromptPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.monthPickerTitle}>ToDoを編集</Text>
              <TextInput
                style={styles.answerPromptInput}
                value={todoEditDraft}
                onChangeText={setTodoEditDraft}
                placeholder="ToDoの内容"
                multiline
                autoFocus
              />
              <View style={styles.answerPromptButtonRow}>
                <TouchableOpacity style={styles.answerPromptButton} onPress={cancelTodoEdit}>
                  <Text style={styles.answerPromptButtonText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.answerPromptButton, styles.answerPromptButtonPrimary]}
                  onPress={confirmTodoEdit}
                >
                  <Text style={styles.answerPromptButtonPrimaryText}>保存</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={monthPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMonthPickerVisible(false)}
      >
        <Pressable style={styles.monthPickerOverlay} onPress={() => setMonthPickerVisible(false)}>
          <Pressable style={styles.monthPickerSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.monthPickerTitle}>月を選択</Text>

            <View style={styles.monthPickerYearNav}>
              <TouchableOpacity
                style={styles.monthPickerYearArrow}
                onPress={() => setMonthPickerYear((y) => y - 1)}
              >
                <Ionicons name="chevron-back" size={20} color="#3c3c43" />
              </TouchableOpacity>
              <Text style={styles.monthPickerYearNavLabel}>{monthPickerYear}年</Text>
              <TouchableOpacity
                style={styles.monthPickerYearArrow}
                onPress={() => setMonthPickerYear((y) => y + 1)}
              >
                <Ionicons name="chevron-forward" size={20} color="#3c3c43" />
              </TouchableOpacity>
            </View>

            <View style={styles.monthPickerGrid}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((monthNum) => {
                const key = `${monthPickerYear}-${String(monthNum).padStart(2, "0")}`;
                const isCurrent = key === displayMonthKey;
                const hasData = monthKeysWithData.has(key);
                const isFuture = key > currentRealMonthKey;
                return (
                  <TouchableOpacity
                    key={monthNum}
                    style={[styles.monthPickerCell, isCurrent && styles.monthPickerCellSelected]}
                    disabled={isFuture}
                    onPress={() => {
                      setCalendarMonthKey(key);
                      setMonthPickerVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.monthPickerCellText,
                        hasData && styles.monthPickerCellTextHasData,
                        isCurrent && styles.monthPickerCellTextSelected,
                      ]}
                    >
                      {monthNum}月
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.monthPickerCloseButton}
              onPress={() => setMonthPickerVisible(false)}
            >
              <Text style={styles.monthPickerCloseText}>閉じる</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const CARD_RADIUS = 14;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ebebf0",
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 10,
    height: 36,
  },
  searchInput: { flex: 1, marginLeft: 6, fontSize: 15 },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: "#ebebf0",
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  segmentSelected: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1,
    elevation: 1,
  },
  segmentText: { fontSize: 13, color: "#3c3c43" },
  segmentTextSelected: { fontWeight: "600" },
  content: { flex: 1, marginTop: 12 },
  sectionHeaderRow: { alignSelf: "flex-start" },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  emptyGroupText: {
    fontSize: 13,
    color: "#c7c7cc",
    marginHorizontal: 16,
    marginBottom: 8,
  },

  // ノートカード(リスト・カレンダー共通)
  card: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: CARD_RADIUS,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  cardBody: { flex: 1, justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1c1c1e" },
  cardMeta: { fontSize: 12, color: "#8e8e93", marginTop: 3 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    gap: 3,
  },
  badgeStar: { backgroundColor: "#fdf0dc" },
  badgeStarIcon: { fontSize: 11, color: "#d98c00" },
  badgeStarText: { fontSize: 11, color: "#d98c00", fontWeight: "600" },
  badgeTodo: { backgroundColor: "#e0f7e6" },
  badgeTodoIcon: { fontSize: 11, color: "#1f9254" },
  badgeTodoText: { fontSize: 11, color: "#1f9254", fontWeight: "600" },
  badgeQuestion: { backgroundColor: "#f2e8fc" },
  badgeQuestionIcon: { fontSize: 11, color: "#7c4dff", fontWeight: "700" },
  badgeQuestionText: { fontSize: 11, color: "#7c4dff", fontWeight: "600" },

  cardNoMargin: { marginHorizontal: 0 },

  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#f2f2f7" },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  thumbBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  thumbBadgeText: { fontSize: 10, color: "#fff", fontWeight: "600" },

  // カレンダー表示
  calHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginHorizontal: 16,
  },
  calNavButton: { padding: 4 },
  calHeaderTitleButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  calHeaderTitle: { fontSize: 16, fontWeight: "700", color: "#1c1c1e", minWidth: 90, textAlign: "center" },
  calWeekdayRow: { flexDirection: "row", marginHorizontal: 16, marginTop: 12 },
  calGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: 16 },
  calCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 6,
  },
  calWeekdayText: { fontSize: 12, color: "#8e8e93" },
  calCellCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  calCellCircleSelected: { backgroundColor: "rgba(0,102,204,0.15)" },
  calCellText: { fontSize: 15, color: "#1c1c1e" },
  calCellTextDim: { color: "#c7c7cc" },
  calCellTextSelected: { color: "#06c", fontWeight: "700" },
  calCellDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3, backgroundColor: "transparent" },
  calCellDotVisible: { backgroundColor: "#06c" },
  calSelectedSection: { marginTop: 4 },

  // 選択日の時間軸アジェンダ(時刻バッジ+縦の連結線)
  timeRow: { flexDirection: "row", marginHorizontal: 16, marginBottom: 10 },
  timeBadgeCol: { alignItems: "center", width: 52, marginRight: 8 },
  timeBadge: {
    paddingHorizontal: 8,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
  },
  timeBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  timeConnector: {
    flex: 1,
    minHeight: 24,
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: "#d1d1d6",
    marginTop: 6,
  },
  timeCardWrap: { flex: 1 },

  // カレンダーヘッダーの月選択ピッカー
  monthPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  monthPickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  monthPickerTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    color: "#1c1c1e",
    marginBottom: 8,
  },
  answerPromptKeyboardAvoider: { flex: 1, justifyContent: "flex-end" },
  answerPromptPanel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
  },
  answerPromptLabel: { fontSize: 12, fontWeight: "700", color: "#8e8e93", marginBottom: -6 },
  answerPromptInput: {
    borderWidth: 1,
    borderColor: "#e2e2e7",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1c1c1e",
    minHeight: 60,
    textAlignVertical: "top",
  },
  answerPromptButtonRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  answerPromptButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#f2f2f7",
  },
  answerPromptButtonPrimary: { backgroundColor: "#06c" },
  answerPromptButtonText: { fontSize: 13, fontWeight: "600", color: "#06c" },
  answerPromptButtonPrimaryText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  monthPickerYearNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    marginBottom: 12,
  },
  monthPickerYearArrow: { padding: 4 },
  monthPickerYearNavLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1c1c1e",
    minWidth: 80,
    textAlign: "center",
  },
  monthPickerGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthPickerCell: {
    width: "25%",
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  monthPickerCellSelected: { backgroundColor: "rgba(0,102,204,0.15)" },
  monthPickerCellText: { fontSize: 15, color: "#c7c7cc" },
  monthPickerCellTextHasData: { color: "#1c1c1e", fontWeight: "700" },
  monthPickerCellTextSelected: { color: "#06c", fontWeight: "700" },
  monthPickerCloseButton: {
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
    backgroundColor: "#06c",
  },
  monthPickerCloseText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  // ToDo表示(ノートごとの小見出し+カード形式の行)
  noteGroupHeader: {
    fontSize: 12,
    color: "#8e8e93",
    marginHorizontal: 16,
    marginBottom: 6,
  },
  todoCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  todoText: { flex: 1, fontSize: 15, color: "#1c1c1e" },
  todoTextDone: { color: "#8e8e93", textDecorationLine: "line-through" },
  questionTextCol: { flex: 1 },
  questionAnswerPreview: { fontSize: 12, color: "#34c759", marginTop: 3 },

  // 検索結果
  searchRow: {
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  searchMeta: { fontSize: 12, color: "#8e8e93" },
  searchSnippet: { fontSize: 15, color: "#1c1c1e", marginTop: 3 },

  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 8,
  },
  placeholderText: { color: "#8e8e93", fontSize: 14 },
});
