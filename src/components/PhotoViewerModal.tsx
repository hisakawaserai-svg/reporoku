import { useEffect, useRef, useState } from "react";
import {
  Animated,
  GestureResponderEvent,
  Image,
  Modal,
  PanResponder,
  PanResponderGestureState,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TAP_MAX_DURATION_MS = 300;
const TAP_MAX_MOVEMENT = 6;
const IMMERSIVE_FADE_MS = 220;

function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export default function PhotoViewerModal({
  visible,
  photoUri,
  caption,
  onClose,
}: {
  visible: boolean;
  photoUri: string | null;
  caption: string | null;
  onClose: () => void;
}) {
  const [immersive, setImmersive] = useState(false);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const gestureStartTranslateRef = useRef({ x: 0, y: 0 });
  const pinchStartDistanceRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const touchMovedRef = useRef(false);
  const touchStartAtRef = useRef(0);
  // タッチ本数が前回のmoveと変わった瞬間(1本→2本、2本→1本)を検知するための直近本数
  const previousTouchCountRef = useRef(0);
  // 没入表示(背景を真っ黒にしてボタン等を隠す)への切り替えを徐々にフェードさせる
  const immersiveAnim = useRef(new Animated.Value(0)).current;

  // 開くたびに(別の写真かもしれないので)拡大・移動・没入表示の状態をリセットする
  useEffect(() => {
    if (visible) {
      setImmersive(false);
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      scaleRef.current = 1;
      translateRef.current = { x: 0, y: 0 };
      immersiveAnim.setValue(0);
    }
  }, [visible, photoUri, immersiveAnim]);

  useEffect(() => {
    Animated.timing(immersiveAnim, {
      toValue: immersive ? 1 : 0,
      duration: IMMERSIVE_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [immersive, immersiveAnim]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        touchMovedRef.current = false;
        touchStartAtRef.current = Date.now();
        gestureStartTranslateRef.current = { ...translateRef.current };
        const touches = evt.nativeEvent.touches;
        previousTouchCountRef.current = touches.length;
        if (touches.length === 2) {
          pinchStartDistanceRef.current = touchDistance(touches);
          pinchStartScaleRef.current = scaleRef.current;
        }
      },
      onPanResponderMove: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2) {
          touchMovedRef.current = true;
          if (previousTouchCountRef.current !== 2) {
            // 1本指→2本指に切り替わった瞬間。RNは指が増えてもonPanResponderGrantを
            // 再度呼ばないため、ここで基準の指の間隔・倍率を取り直す
            pinchStartDistanceRef.current = touchDistance(touches);
            pinchStartScaleRef.current = scaleRef.current;
          } else if (pinchStartDistanceRef.current > 0) {
            const ratio = touchDistance(touches) / pinchStartDistanceRef.current;
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScaleRef.current * ratio));
            scaleRef.current = next;
            setScale(next);
          }
        } else if (touches.length === 1) {
          if (previousTouchCountRef.current !== 1) {
            // 2本指→1本指に戻った瞬間。移動量の基準位置を今の位置に取り直し、
            // 指が入れ替わった際の急なジャンプを防ぐ
            gestureStartTranslateRef.current = { ...translateRef.current };
          } else {
            if (
              Math.abs(gestureState.dx) > TAP_MAX_MOVEMENT ||
              Math.abs(gestureState.dy) > TAP_MAX_MOVEMENT
            ) {
              touchMovedRef.current = true;
            }
            if (scaleRef.current > 1) {
              const next = {
                x: gestureStartTranslateRef.current.x + gestureState.dx,
                y: gestureStartTranslateRef.current.y + gestureState.dy,
              };
              translateRef.current = next;
              setTranslate(next);
            }
          }
        }

        previousTouchCountRef.current = touches.length;
      },
      onPanResponderRelease: () => {
        // 動きがほぼ無いまま指を離した場合はタップとみなし、没入表示を切り替える
        if (!touchMovedRef.current && Date.now() - touchStartAtRef.current < TAP_MAX_DURATION_MS) {
          setImmersive((prev) => !prev);
        }
        // 縮小しすぎた場合は等倍・中央位置へ戻す
        if (scaleRef.current <= 1) {
          scaleRef.current = 1;
          translateRef.current = { x: 0, y: 0 };
          setScale(1);
          setTranslate({ x: 0, y: 0 });
        }
      },
    })
  ).current;

  const handleShare = async () => {
    if (!photoUri) return;
    try {
      await Share.share({ url: photoUri });
    } catch (e) {
      console.warn("[Share] 写真の共有に失敗しました", e);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // バツボタン以外では閉じない(Androidの戻る操作も無効化する)
      }}
    >
      <View style={styles.root}>
        <View style={styles.backdrop} />
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, styles.backdropImmersive, { opacity: immersiveAnim }]}
        />
        <View style={styles.imageWrap} {...panResponder.panHandlers}>
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              resizeMode="contain"
              style={[
                styles.image,
                {
                  transform: [
                    { translateX: translate.x },
                    { translateY: translate.y },
                    { scale },
                  ],
                },
              ]}
            />
          ) : null}
        </View>
        <Animated.View
          style={[styles.topBar, { opacity: immersiveAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
          pointerEvents={immersive ? "none" : "box-none"}
        >
          <TouchableOpacity style={styles.iconButton} onPress={onClose}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
        {caption ? (
          <Animated.View
            style={[
              styles.captionWrap,
              { opacity: immersiveAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.captionText}>{caption}</Text>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  backdropImmersive: { backgroundColor: "#000" },
  imageWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  image: { width: "100%", height: "100%" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  captionWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 40,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  captionText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: "hidden",
  },
});
