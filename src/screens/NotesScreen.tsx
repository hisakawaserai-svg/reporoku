import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
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

type IconName = keyof typeof Ionicons.glyphMap;

type DisplayMode = "list" | "calendar";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "list", label: "リスト" },
  { key: "calendar", label: "カレンダー" },
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
  // リスト/カレンダーの行(セッションカード)を長押しして開く選択肢メニュー。ノート詳細画面の
  // 長押しメニューとレイアウトを揃えるため、対象行の実測座標の近くにカード状のメニューを吹き出し表示する
  type RowMenuKind = "session";
  const [rowMenuAnchor, setRowMenuAnchor] = useState<{
    kind: RowMenuKind;
    block: BlockWithSession | SessionSummary;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const rowMenuRefs = useRef<Map<string, View>>(new Map());
  // 長押しした行を、ノート詳細画面のopenBlockMenuと同じく少し拡大したゴーストとして表示するアニメーション
  const rowMenuHighlightScale = useRef(new Animated.Value(1)).current;
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

  // リスト/カレンダータブの行を長押しして選択肢メニューを開く。ノート詳細画面のopenBlockMenuと
  // 同じく、対象行の画面上の実測座標を取得してその近くにメニューを表示する
  const openRowMenu = (kind: RowMenuKind, block: BlockWithSession | SessionSummary) => {
    const node = rowMenuRefs.current.get(block.id);
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setRowMenuAnchor({ kind, block, x, y, width, height });
      rowMenuHighlightScale.setValue(1);
      Animated.spring(rowMenuHighlightScale, {
        toValue: 1.06,
        friction: 4,
        tension: 160,
        useNativeDriver: true,
      }).start();
    });
  };

  // 閉じる時も、拡大を元に戻すアニメーションを再生してから消す
  const closeRowMenu = (after?: () => void) => {
    Animated.timing(rowMenuHighlightScale, { toValue: 1, duration: 140, useNativeDriver: true }).start(() => {
      setRowMenuAnchor(null);
      after?.();
    });
  };

  useFocusEffect(
    useCallback(() => {
      loadNotes();
    }, [loadNotes])
  );

  const trimmedQuery = query.trim();
  // trigramトークナイザの制約で3文字未満は検索できない(ヒット0件と区別して案内する)
  const queryTooShort = trimmedQuery.length > 0 && trimmedQuery.length < 3;

  useEffect(() => {
    if (!trimmedQuery || queryTooShort) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    blocksRepo
      .search(trimmedQuery)
      .then((rows) => {
        if (!cancelled) setSearchResults(rows);
      })
      .catch((e) => console.warn("[DB] 検索に失敗しました", e));
    return () => {
      cancelled = true;
    };
  }, [trimmedQuery, queryTooShort]);

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

  const isSearching = trimmedQuery.length > 0;

  const searchGroupsForMode = useMemo(() => groupBySession(searchResults), [searchResults]);
  const searchResultCountForMode = searchResults.length;
  const searchPlaceholder = "ノートを検索";

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
          } catch (e) {
            console.warn("[DB] ノートの削除に失敗しました", e);
          }
        },
      },
    ]);
  };

  // カード本体の中身(タイトル・メタ・バッジ・サムネイル)。長押しメニューのゴーストカードでも
  // 全く同じ関数を呼んで描画することで、実際のカードと見た目が食い違わないようにする
  const renderCardContent = (session: SessionSummary) => {
    const thumbBadge =
      session.photoCount > 1
        ? `+${session.photoCount - 1}枚`
        : session.photoCount === 1
        ? "1枚"
        : null;

    return (
      <>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {noteDisplayTitle(session)}
          </Text>
          <Text style={styles.cardMeta}>
            {formatTime(session.startedAt)} 開始 ・ {formatDuration(session.durationMs)}
          </Text>
          {session.starCount > 0 || session.todoCount > 0 || session.questionCount > 0 ? (
            <View style={styles.badgeRow}>
              {session.starCount > 0 ? (
                <View style={[styles.badge, styles.badgeStar]}>
                  <Text style={styles.badgeStarIcon}>★</Text>
                  <Text style={styles.badgeStarText}>{session.starCount}</Text>
                </View>
              ) : null}
              {session.todoCount > 0 ? (
                <View style={[styles.badge, styles.badgeTodo]}>
                  <Text style={styles.badgeTodoIcon}>✓</Text>
                  <Text style={styles.badgeTodoText}>{session.todoCount}</Text>
                </View>
              ) : null}
              {session.questionCount > 0 ? (
                <View style={[styles.badge, styles.badgeQuestion]}>
                  <Text style={styles.badgeQuestionIcon}>?</Text>
                  <Text style={styles.badgeQuestionText}>{session.questionCount}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
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
      </>
    );
  };

  const renderCard = (session: SessionSummary, compact = false) => (
    <TouchableOpacity
      key={session.id}
      style={[styles.card, compact && styles.cardNoMargin]}
      activeOpacity={0.7}
      onPress={() => goToNote(session.id)}
      onLongPress={() => openRowMenu("session", session)}
      ref={(node) => {
        if (node) rowMenuRefs.current.set(session.id, node);
        else rowMenuRefs.current.delete(session.id);
      }}
    >
      {renderCardContent(session)}
    </TouchableOpacity>
  );

  // リスト/カレンダータブの長押しメニューの項目。ノート詳細画面のactionItems(テキスト+アイコンの
  // 横並び行)と同じ形にする
  type RowMenuItem = { key: string; label: string; icon: IconName; color: string; onPress: () => void };
  const rowMenuItems: RowMenuItem[] = !rowMenuAnchor
    ? []
    : (() => {
        const session = rowMenuAnchor.block as SessionSummary;
        return [
          {
            key: "open",
            label: "ノートを開く",
            icon: "open-outline" as IconName,
            color: "#06c",
            onPress: () => closeRowMenu(() => goToNote(session.id)),
          },
          {
            key: "delete",
            label: "削除",
            icon: "trash-outline" as IconName,
            color: "#ff3b30",
            onPress: () => closeRowMenu(() => confirmDeleteSession(session)),
          },
        ];
      })();

  // メニューの位置決め。ノート詳細画面のmenuList位置計算と同じロジック
  // (吹き出しが画面外にはみ出さないよう、上下どちらに表示するかを空きスペースで判定する)
  const ROW_MENU_ITEM_HEIGHT = 44;
  // ゴーストカードが少し傾いているため、その分だけ余分に隙間を空けてメニューと被らないようにする
  const ROW_MENU_GAP = 13;
  const ROW_MENU_WIDTH = 220;
  const ROW_MENU_SCREEN_MARGIN = 40;
  let rowMenuTop = 0;
  let rowMenuLeft = 0;
  let rowMenuHighlightTop = 0;
  if (rowMenuAnchor) {
    const windowHeight = Dimensions.get("window").height;
    const windowWidth = Dimensions.get("window").width;
    const menuHeight = rowMenuItems.length * ROW_MENU_ITEM_HEIGHT;
    const spaceBelow = windowHeight - (rowMenuAnchor.y + rowMenuAnchor.height) - ROW_MENU_GAP;
    const spaceAbove = rowMenuAnchor.y - ROW_MENU_GAP;
    const showBelow = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
    rowMenuTop = showBelow
      ? rowMenuAnchor.y + rowMenuAnchor.height + ROW_MENU_GAP
      : rowMenuAnchor.y - ROW_MENU_GAP - menuHeight;
    const minTop = ROW_MENU_SCREEN_MARGIN;
    const maxTop = windowHeight - menuHeight - ROW_MENU_SCREEN_MARGIN;
    rowMenuTop = Math.max(minTop, Math.min(rowMenuTop, maxTop));
    rowMenuLeft = Math.max(16, Math.min(rowMenuAnchor.x, windowWidth - ROW_MENU_WIDTH - 16));
    rowMenuHighlightTop = Math.max(
      ROW_MENU_SCREEN_MARGIN,
      Math.min(rowMenuAnchor.y, windowHeight - rowMenuAnchor.height - ROW_MENU_SCREEN_MARGIN)
    );
  }

  const renderNoteGroupHeader = (group: { sessionTitle: string; sessionStartedAt: number }) => (
    <Text style={styles.noteGroupHeader}>
      {group.sessionTitle || "無題のノート"} ・ {formatDateSlash(group.sessionStartedAt)}
    </Text>
  );

  // リスト/カレンダータブの検索結果行。ヒットしたセッション単位でまとめて表示するため
  // (renderNoteGroupHeaderが見出しを出す)、ここでは行ごとのスニペットのみを表示する
  // blocks.tsのsearch()がsnippet(blocks_fts, -1, '[', ']', ...)でマッチ箇所を'['']'で
  // 囲んで返してくるので、それを解析してToDo/質問タブと同じ黄色マーカー型ハイライトで表示する
  const renderSnippet = (snippet: string) =>
    snippet.split(/(\[[^\]]*\])/g).map((part, i) =>
      part.startsWith("[") && part.endsWith("]") ? (
        <Text key={i} style={styles.searchHighlight}>
          {part.slice(1, -1)}
        </Text>
      ) : (
        part
      )
    );

  const renderSearchRow = (result: SearchResult) => (
    <TouchableOpacity
      key={result.id}
      style={styles.searchRow}
      activeOpacity={0.7}
      onPress={() => goToBlock(result)}
    >
      <Text style={styles.searchSnippet}>{renderSnippet(result.snippet)}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 検索バー */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8e8e93" />
        <TextInput
          style={styles.searchInput}
          placeholder={searchPlaceholder}
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
            {queryTooShort ? (
              <View style={styles.placeholder}>
                <Ionicons name="search-outline" size={32} color="#c7c7cc" />
                <Text style={styles.placeholderText}>もう少し詳しく入力してください</Text>
              </View>
            ) : searchResultCountForMode === 0 ? (
              <View style={styles.placeholder}>
                <Ionicons name="search-outline" size={32} color="#c7c7cc" />
                <Text style={styles.placeholderText}>検索結果がありません</Text>
              </View>
            ) : (
              searchGroupsForMode.map((group) => (
                <View key={group.sessionId}>
                  {renderNoteGroupHeader(group)}
                  {(group.items as SearchResult[]).map(renderSearchRow)}
                </View>
              ))
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
                  monthGroups.map((group) => {
                    const [year, month] = group.monthKey.split("-");
                    return (
                      <View key={group.monthKey}>
                        <View style={styles.monthHeaderRow}>
                          <View style={styles.monthHeaderPill}>
                            <Text style={styles.monthHeaderPillText}>{Number(month)}月</Text>
                          </View>
                          <Text style={styles.monthHeaderYear}>{year}年</Text>
                        </View>
                        {group.items.map((session) => renderCard(session))}
                      </View>
                    );
                  })
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
                  {selectedDateKey ? (
                    <View style={styles.dayHeaderRow}>
                      <View style={styles.dayHeaderPill}>
                        <Text style={styles.dayHeaderPillText}>
                          {Number(selectedDateKey.split("-")[2])}日
                        </Text>
                      </View>
                      <Text style={styles.dayHeaderWeekday}>
                        {formatWeekdayLabel(selectedDateKey)}曜日
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.sectionHeader}>日付を選択してください</Text>
                  )}
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

          </>
        )}
      </ScrollView>

      <Modal
        visible={rowMenuAnchor !== null}
        animationType="fade"
        transparent
        onRequestClose={() => closeRowMenu()}
      >
        <Pressable style={styles.rowMenuOverlay} onPress={() => closeRowMenu()}>
          {rowMenuAnchor ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.rowMenuHighlight,
                  {
                    top: rowMenuHighlightTop,
                    left: rowMenuAnchor.x,
                    width: rowMenuAnchor.width,
                    minHeight: rowMenuAnchor.height,
                    transform: [{ scale: rowMenuHighlightScale }],
                  },
                ]}
              >
                <View style={styles.rowMenuHighlightCardRow}>
                  {renderCardContent(rowMenuAnchor.block as SessionSummary)}
                </View>
              </Animated.View>
              <View style={[styles.rowMenuList, { top: rowMenuTop, left: rowMenuLeft, width: ROW_MENU_WIDTH }]}>
                {rowMenuItems.map((item, index) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.rowMenuItem, index > 0 && styles.rowMenuItemDivider]}
                    onPress={item.onPress}
                  >
                    <Text style={styles.rowMenuItemText}>{item.label}</Text>
                    <Ionicons name={item.icon} size={18} color={item.color} />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}
        </Pressable>
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
  // リスト/カレンダータブの長押しメニュー。ノート詳細画面のmenuOverlay/menuList/menuItemと
  // 同じ見た目(丸角カード+区切り線付きの行)に揃える
  rowMenuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  // 長押しメニュー表示中のゴーストカード。iOS純正の白背景+テープ+わずかな傾きで
  // 「持ち上げた」感を出す
  rowMenuHighlight: {
    position: "absolute",
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  rowMenuHighlightText: { fontSize: 15, color: "#1c1c1e" },
  // ゴーストカードの中でrenderCardContentを呼ぶ際、実カード(styles.card)と同じ
  // 横並びレイアウトになるようにする(rowMenuHighlight自体は向き指定を持たないため)
  rowMenuHighlightCardRow: { flexDirection: "row", gap: 10 },
  rowMenuList: {
    position: "absolute",
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  rowMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowMenuItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5ea" },
  rowMenuItemText: { fontSize: 15, color: "#1c1c1e" },
  content: { flex: 1, marginTop: 12 },
  sectionHeaderRow: { alignSelf: "flex-start" },
  sectionHeader: {
    fontSize: 13,
    color: "#8e8e93",
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  // リストタブの月見出し(マステ風): 月をパステルのピルで強調し、年は控えめに添える
  monthHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  // マスキングテープ風に、角の丸みを抑えて少し傾ける
  monthHeaderPill: {
    backgroundColor: "#dcebfd",
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 5,
    transform: [{ rotate: "-3deg" }],
  },
  monthHeaderPillText: { fontSize: 13, fontWeight: "700", color: "#1c1c1e" },
  monthHeaderYear: { fontSize: 13, color: "#8e8e93" },

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
  badgeRow: { flexDirection: "row", gap: 7, marginTop: 8 },
  // ぷっくりパステルバッジ: 完全な丸みと余裕のあるパディングで「ぷっくり」感を出す
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 3,
  },
  badgeStar: { backgroundColor: "#fdf0dc" },
  badgeStarIcon: { fontSize: 12, color: "#d98c00" },
  badgeStarText: { fontSize: 12, color: "#d98c00", fontWeight: "700" },
  badgeTodo: { backgroundColor: "#e0f7e6" },
  badgeTodoIcon: { fontSize: 12, color: "#1f9254" },
  badgeTodoText: { fontSize: 12, color: "#1f9254", fontWeight: "700" },
  badgeQuestion: { backgroundColor: "#f2e8fc" },
  badgeQuestionIcon: { fontSize: 12, color: "#7c4dff", fontWeight: "700" },
  badgeQuestionText: { fontSize: 12, color: "#7c4dff", fontWeight: "700" },

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
  // 選択日の見出し。日付はマスキングテープ風に少し傾けたピルで強調し、曜日は控えめに添える
  dayHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  dayHeaderPill: {
    backgroundColor: "#dcebfd",
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 5,
    transform: [{ rotate: "-3deg" }],
  },
  dayHeaderPillText: { fontSize: 13, fontWeight: "700", color: "#1c1c1e" },
  dayHeaderWeekday: { fontSize: 13, color: "#8e8e93" },

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

  // 検索結果のノートごとの小見出し
  noteGroupHeader: {
    fontSize: 12,
    color: "#8e8e93",
    marginHorizontal: 16,
    marginBottom: 6,
  },

  // 検索結果
  searchRow: {
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  searchSnippet: { fontSize: 15, color: "#1c1c1e", marginTop: 3 },
  // 黄色マーカー型ハイライト(背景色でハイライト)
  // 手書きマーカー型ハイライト。RNのTextはclip-pathに対応しないため、平行四辺形の
  // 代わりにborderRadiusを非対称にして「なぞった線」らしい不揃いさを出す
  searchHighlight: {
    backgroundColor: "#FFD873",
    borderTopLeftRadius: 1,
    borderBottomRightRadius: 1,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 1,
  },

  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 8,
  },
  placeholderText: { color: "#8e8e93", fontSize: 14 },
});
