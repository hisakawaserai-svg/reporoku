import { useRef, useState } from "react";
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

export type RowMenuItem = {
  key: string;
  label: string;
  icon: IconName;
  color?: string;
  onPress: () => void;
};

type Anchor<T> = {
  data: T;
  x: number;
  y: number;
  width: number;
  height: number;
};

// 行の長押しで「持ち上げた」ゴーストカード+選択肢メニューを開く一連の挙動を
// 画面をまたいで使い回すためのフック。位置計測・アニメーション・寸法だけを扱い、
// メニュー項目やプレビューの中身は呼び出し側(RowLongPressMenu)に委ねる
export function useRowLongPressMenu<T>() {
  const [anchor, setAnchor] = useState<Anchor<T> | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const refs = useRef(new Map<string, View>()).current;

  const registerRef = (id: string) => (node: View | null) => {
    if (node) refs.set(id, node);
    else refs.delete(id);
  };

  const open = (id: string, data: T) => {
    const node = refs.get(id);
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setAnchor({ data, x, y, width, height });
      scale.setValue(1);
      Animated.spring(scale, { toValue: 1.08, friction: 4, tension: 160, useNativeDriver: true }).start();
    });
  };

  const close = (after?: () => void) => {
    Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }).start(() => {
      setAnchor(null);
      after?.();
    });
  };

  return { anchor, scale, registerRef, open, close };
}

const MENU_ITEM_HEIGHT = 44;
const MENU_GAP = 28;
const MENU_WIDTH = 230;
const MENU_SCREEN_MARGIN = 40;

// 長押しメニュー本体。「持ち上げた」ゴーストカードでタップした行のプレビューを見せつつ、
// その近くに選択肢メニューを吹き出し表示する(ノート詳細画面のブロックメニューと同じ見た目)
export function RowLongPressMenu<T>({
  anchor,
  scale,
  items,
  onClose,
  accentBarColor,
  renderPreview,
}: {
  anchor: Anchor<T> | null;
  scale: Animated.Value;
  items: RowMenuItem[];
  onClose: () => void;
  // ToDo系の行にだけ添える左端のアクセントバー(元のNotesScreen/NoteDetailScreenの
  // rowMenuAccentBar/timelineAccentBarと同じ見た目)。不要なkindではundefinedのまま渡す
  accentBarColor?: string;
  renderPreview: (data: T) => React.ReactNode;
}) {
  let top = 0;
  let left = 0;
  let highlightTop = 0;
  if (anchor) {
    const windowHeight = Dimensions.get("window").height;
    const windowWidth = Dimensions.get("window").width;
    const menuHeight = items.length * MENU_ITEM_HEIGHT;
    const spaceBelow = windowHeight - (anchor.y + anchor.height) - MENU_GAP;
    const spaceAbove = anchor.y - MENU_GAP;
    const showBelow = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
    top = showBelow ? anchor.y + anchor.height + MENU_GAP : anchor.y - MENU_GAP - menuHeight;
    const minTop = MENU_SCREEN_MARGIN;
    const maxTop = windowHeight - menuHeight - MENU_SCREEN_MARGIN;
    top = Math.max(minTop, Math.min(top, maxTop));
    left = Math.max(16, Math.min(anchor.x, windowWidth - MENU_WIDTH - 16));
    highlightTop = Math.max(
      MENU_SCREEN_MARGIN,
      Math.min(anchor.y, windowHeight - anchor.height - MENU_SCREEN_MARGIN)
    );
  }

  return (
    <Modal visible={anchor !== null} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        {anchor ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.highlight,
                {
                  top: highlightTop,
                  left: anchor.x,
                  width: anchor.width,
                  minHeight: anchor.height,
                  transform: [{ scale }],
                },
              ]}
            >
              {accentBarColor ? (
                <View style={[styles.accentBar, { backgroundColor: accentBarColor }]} />
              ) : null}
              {renderPreview(anchor.data)}
            </Animated.View>
            <View style={[styles.menuList, { top, left, width: MENU_WIDTH }]}>
              {items.map((item, index) => (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.menuItem, index > 0 && styles.menuItemDivider]}
                  onPress={item.onPress}
                >
                  <Text style={styles.menuItemText}>{item.label}</Text>
                  <Ionicons name={item.icon} size={18} color={item.color ?? "#3c3c43"} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  highlight: {
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
  accentBar: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderRadius: 2,
  },
  menuList: {
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
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  menuItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5ea" },
  menuItemText: { fontSize: 15, color: "#1c1c1e" },
});
