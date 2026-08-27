import { useEffect, useRef, useState } from "react";
import {
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

  // 開くたびに(別の写真かもしれないので)拡大・移動・没入表示の状態をリセットする
  useEffect(() => {
    if (visible) {
      setImmersive(false);
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      scaleRef.current = 1;
      translateRef.current = { x: 0, y: 0 };
    }
  }, [visible, photoUri]);

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
        if (touches.length === 2) {
          pinchStartDistanceRef.current = touchDistance(touches);
          pinchStartScaleRef.current = scaleRef.current;
        }
      },
      onPanResponderMove: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          touchMovedRef.current = true;
          if (pinchStartDistanceRef.current > 0) {
            const ratio = touchDistance(touches) / pinchStartDistanceRef.current;
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScaleRef.current * ratio));
            scaleRef.current = next;
            setScale(next);
          }
        } else if (touches.length === 1) {
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
        <View style={[styles.backdrop, immersive && styles.backdropImmersive]} />
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
        {!immersive ? (
          <>
            <View style={styles.topBar} pointerEvents="box-none">
              <TouchableOpacity style={styles.iconButton} onPress={onClose}>
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={handleShare}>
                <Ionicons name="share-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {caption ? (
              <View style={styles.captionWrap} pointerEvents="none">
                <Text style={styles.captionText}>{caption}</Text>
              </View>
            ) : null}
          </>
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
