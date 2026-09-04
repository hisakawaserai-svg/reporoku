import { useEffect, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const EDGE_SLACK = 48;
const HIDE_AFTER_JUMP_MS = 2500;

export function computeLogJumpVisibility(
  scrollY: number,
  viewportH: number,
  contentH: number
): { showTop: boolean; showBottom: boolean } {
  const maxScroll = Math.max(0, contentH - viewportH);
  if (maxScroll <= EDGE_SLACK) return { showTop: false, showBottom: false };
  return {
    showTop: scrollY > EDGE_SLACK,
    showBottom: scrollY < maxScroll - EDGE_SLACK,
  };
}

type Props = {
  showTop: boolean;
  showBottom: boolean;
  onTop: () => void;
  onBottom: () => void;
};

/** 親(ログ領域)の右上／右下に浮く。ジャンプ直後の数秒は出さない。 */
export function LogJumpButtons({ showTop, showBottom, onTop, onBottom }: Props) {
  const [hidden, setHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const jump = (fn: () => void) => {
    fn();
    setHidden(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHidden(false), HIDE_AFTER_JUMP_MS);
  };

  if (hidden) return null;

  return (
    <>
      {showTop ? (
        <TouchableOpacity
          style={[styles.button, styles.top]}
          activeOpacity={0.7}
          onPress={() => jump(onTop)}
        >
          <Ionicons name="chevron-up" size={20} color="#3c3c43" />
        </TouchableOpacity>
      ) : null}
      {showBottom ? (
        <TouchableOpacity
          style={[styles.button, styles.bottom]}
          activeOpacity={0.7}
          onPress={() => jump(onBottom)}
        >
          <Ionicons name="chevron-down" size={20} color="#3c3c43" />
        </TouchableOpacity>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    right: 10,
    zIndex: 6,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 6,
  },
  top: { top: 8 },
  bottom: { bottom: 8 },
});
