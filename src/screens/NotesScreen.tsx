import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
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

type DisplayMode = "list" | "calendar" | "todo" | "glossary";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "list", label: "リスト" },
  { key: "calendar", label: "カレンダー" },
  { key: "todo", label: "ToDo" },
  { key: "glossary", label: "用語集" },
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

// 50音索引の行(あ行〜わ行)。用語集の簡易グルーピングに使う
const KANA_ROWS = ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"] as const;
type KanaRow = (typeof KANA_ROWS)[number];

const KANA_ROW_CHARS: Record<KanaRow, string[]> = {
  あ: ["あ", "い", "う", "え", "お", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ"],
  か: ["か", "き", "く", "け", "こ", "が", "ぎ", "ぐ", "げ", "ご"],
  さ: ["さ", "し", "す", "せ", "そ", "ざ", "じ", "ず", "ぜ", "ぞ"],
  た: ["た", "ち", "つ", "て", "と", "だ", "ぢ", "づ", "で", "ど", "っ"],
  な: ["な", "に", "ぬ", "ね", "の"],
  は: ["は", "ひ", "ふ", "へ", "ほ", "ば", "び", "ぶ", "べ", "ぼ", "ぱ", "ぴ", "ぷ", "ぺ", "ぽ"],
  ま: ["ま", "み", "む", "め", "も"],
  や: ["や", "ゆ", "よ", "ゃ", "ゅ", "ょ"],
  ら: ["ら", "り", "る", "れ", "ろ"],
  わ: ["わ", "を", "ん", "ゐ", "ゑ"],
};

// カタカナはひらがなの対応する行に丸める
function toHiraganaChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x30a1 && code <= 0x30f6) return String.fromCharCode(code - 0x60);
  return ch;
}

// question_term の先頭文字から、機械的に50音の行へ振り分ける。
// 仮名以外(漢字・英数字など)は読み仮名を推定せず、コードポイント順で
// 適当な行に配置する簡易実装とする
function kanaRowOf(term: string): KanaRow {
  if (!term) return "わ";
  const ch = toHiraganaChar(term[0]);
  for (const row of KANA_ROWS) {
    if (KANA_ROW_CHARS[row].includes(ch)) return row;
  }
  const idx = (term.codePointAt(0) ?? 0) % KANA_ROWS.length;
  return KANA_ROWS[idx];
}

type GlossaryGroup = { row: KanaRow; items: BlockWithSession[] };

function groupByKanaRow(blocks: BlockWithSession[]): GlossaryGroup[] {
  const byRow = new Map<KanaRow, BlockWithSession[]>();
  for (const block of blocks) {
    const term = block.questionTerm || block.text || "";
    const row = kanaRowOf(term);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push(block);
  }
  return KANA_ROWS.filter((row) => byRow.has(row)).map((row) => ({ row, items: byRow.get(row)! }));
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
  const [questions, setQuestions] = useState<BlockWithSession[]>([]);
  const [calendarMonthKey, setCalendarMonthKey] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() => new Date().getFullYear());
  const calendarInitRef = useRef(false);
  const glossaryScrollRef = useRef<ScrollView>(null);
  const glossaryRowYRef = useRef<Map<string, number>>(new Map());

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
      console.warn("[DB] 用語集の取得に失敗しました", e);
    }
  }, []);

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

  const renderNoteGroupHeader = (group: { sessionTitle: string; sessionStartedAt: number }) => (
    <Text style={styles.noteGroupHeader}>
      {group.sessionTitle || "無題のノート"} ・ {formatDateSlash(group.sessionStartedAt)}
    </Text>
  );

  const renderQuestionRow = (block: BlockWithSession) => (
    <TouchableOpacity
      key={block.id}
      style={styles.glossaryRow}
      activeOpacity={0.7}
      onPress={() => goToBlock(block)}
    >
      <Text style={styles.glossaryTerm}>{block.questionTerm || block.text}</Text>
      <Text style={styles.glossaryMeta}>
        {block.sessionTitle || "無題のノート"} ・ {formatDateShort(block.sessionStartedAt)}
      </Text>
    </TouchableOpacity>
  );

  const scrollGlossaryToRow = (row: string) => {
    const y = glossaryRowYRef.current.get(row);
    if (y === undefined) return;
    glossaryScrollRef.current?.scrollTo({ y: Math.max(0, y - 4), animated: true });
  };

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

      {(isSearching || mode !== "glossary") && (
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
                    <Text style={styles.sectionHeader}>未対応 ・ {todos.pending.length}件</Text>
                    {todos.pending.length === 0 ? (
                      <Text style={styles.emptyGroupText}>なし</Text>
                    ) : (
                      groupBySession(todos.pending).map((group) => (
                        <View key={group.sessionId}>
                          {renderNoteGroupHeader(group)}
                          {group.items.map(renderTodoRow)}
                        </View>
                      ))
                    )}
                    <Text style={styles.sectionHeader}>完了 ・ {todos.done.length}件</Text>
                    {todos.done.length === 0 ? (
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
          </>
        )}
      </ScrollView>
      )}

      {!isSearching && mode === "glossary" && (
        <View style={styles.glossaryContainer}>
          <ScrollView ref={glossaryScrollRef} style={styles.content}>
            {questions.length === 0 ? (
              <View style={styles.placeholder}>
                <Ionicons name="help-circle-outline" size={32} color="#c7c7cc" />
                <Text style={styles.placeholderText}>用語集はまだありません</Text>
              </View>
            ) : (
              groupByKanaRow(questions).map((group) => (
                <View
                  key={group.row}
                  onLayout={(e) => glossaryRowYRef.current.set(group.row, e.nativeEvent.layout.y)}
                >
                  <Text style={styles.sectionHeader}>{group.row}行</Text>
                  {group.items.map(renderQuestionRow)}
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.glossaryIndexBar}>
            {KANA_ROWS.map((row) => (
              <TouchableOpacity key={row} hitSlop={4} onPress={() => scrollGlossaryToRow(row)}>
                <Text style={styles.glossaryIndexText}>{row}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

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

  // 用語集表示
  glossaryContainer: { flex: 1, flexDirection: "row" },
  glossaryRow: {
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  glossaryTerm: { fontSize: 16, fontWeight: "600", color: "#1c1c1e" },
  glossaryMeta: { fontSize: 12, color: "#8e8e93", marginTop: 2 },
  glossaryIndexBar: {
    width: 20,
    marginTop: 12,
    paddingRight: 4,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  glossaryIndexText: { fontSize: 11, color: "#8e8e93", fontWeight: "600" },

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
