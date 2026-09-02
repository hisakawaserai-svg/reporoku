import { useRef } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";

// セクション区切り・段落の改行、いずれも「ある閾値(ms)を、指定した範囲内で0.5秒刻みに
// 調整する」という同じ形のUIのため、共通コンポーネントとして切り出したもの。
// 再生バーのシークバーと同じ考え方の、PanResponderベースの独立したトラック
export default function GapSlider({
  valueMs,
  minMs,
  maxMs,
  stepMs,
  label,
  fineLabel,
  coarseLabel,
  onChange,
  onChangeComplete,
  onDragStart,
  onDragEnd,
  defaultValueMs,
}: {
  valueMs: number;
  minMs: number;
  maxMs: number;
  stepMs: number;
  label: string;
  fineLabel: string;
  coarseLabel: string;
  onChange: (ms: number) => void;
  onChangeComplete: (ms: number) => void;
  // 縦スクロール可能なコンテナ(ScrollView等)の中に置く場合、ドラッグ中はスクロールを
  // 邪魔されないよう親側で一時的に無効化するためのフック(呼び出し側で任意に使う)
  onDragStart?: () => void;
  onDragEnd?: () => void;
  // 基準となる値(既定値など)がある場合、トラック上に薄い縦線で目印を表示する。
  // 現在の範囲(minMs〜maxMs)の外にある場合は表示しない
  defaultValueMs?: number;
}) {
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  // PanResponderはuseRefで一度だけ作られるため、内部から呼ぶコールバックは常に最新のpropsを
  // 参照するようrefを介す(再生バーのシークバーと同じ理由)
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onChangeCompleteRef = useRef(onChangeComplete);
  onChangeCompleteRef.current = onChangeComplete;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const rangeRef = useRef({ minMs, maxMs, stepMs });
  rangeRef.current = { minMs, maxMs, stepMs };

  const msFromRatio = (ratio: number): number => {
    const { minMs: min, maxMs: max, stepMs: step } = rangeRef.current;
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, stepped));
  };

  const ratioFromPageX = (pageX: number): number => {
    if (trackWidthRef.current <= 0) return 0;
    return Math.min(1, Math.max(0, (pageX - trackPageXRef.current) / trackWidthRef.current));
  };

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
    trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
      trackPageXRef.current = pageX;
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        onDragStartRef.current?.();
        onChangeRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        onChangeRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
      },
      onPanResponderRelease: (evt: GestureResponderEvent) => {
        onChangeCompleteRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
        onDragEndRef.current?.();
      },
      onPanResponderTerminate: (evt: GestureResponderEvent) => {
        onChangeCompleteRef.current(msFromRatio(ratioFromPageX(evt.nativeEvent.pageX)));
        onDragEndRef.current?.();
      },
    })
  ).current;

  const ratio = maxMs > minMs ? (Math.min(maxMs, Math.max(minMs, valueMs)) - minMs) / (maxMs - minMs) : 0;
  const defaultRatio =
    defaultValueMs !== undefined && maxMs > minMs && defaultValueMs >= minMs && defaultValueMs <= maxMs
      ? (defaultValueMs - minMs) / (maxMs - minMs)
      : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View ref={trackRef} style={styles.track} onLayout={handleTrackLayout} {...panResponder.panHandlers}>
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: `${ratio * 100}%` }]} />
        {defaultRatio !== null ? (
          <View pointerEvents="none" style={[styles.defaultMark, { left: `${defaultRatio * 100}%` }]} />
        ) : null}
        <View style={[styles.thumb, { left: `${ratio * 100}%` }]} />
      </View>
      <View style={styles.endsRow}>
        <Text style={styles.endText}>{fineLabel}</Text>
        <Text style={styles.endText}>{coarseLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  label: { fontSize: 12, color: "#8e8e93", marginBottom: 6 },
  track: { height: 24, justifyContent: "center" },
  trackBg: { height: 4, borderRadius: 2, backgroundColor: "#e2e2e7" },
  trackFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    backgroundColor: "#06c",
  },
  thumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#06c",
    marginLeft: -9,
  },
  // 基準値の目印。トラック(高さ24)の中央に、背景バー(高さ4)より少し長い薄い縦線を重ねる
  defaultMark: {
    position: "absolute",
    width: 2,
    height: 12,
    top: 6,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: "#b8b8bd",
  },
  endsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  endText: { fontSize: 11, color: "#c7c7cc" },
});
