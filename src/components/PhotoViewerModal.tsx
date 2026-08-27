import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  HandlerStateChangeEvent,
  PanGestureHandler,
  PanGestureHandlerEventPayload,
  PinchGestureHandler,
  PinchGestureHandlerEventPayload,
  State,
  TapGestureHandler,
} from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const IMMERSIVE_FADE_MS = 220;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const [isZoomed, setIsZoomed] = useState(false);

  // 確定済みの値(JS側の数値)と、ジェスチャー中だけ動く値を別々に持ち、
  // ジェスチャー終了時に前者へ合成する。表示上のscale/translateはこの2つの積・和
  const lastScaleRef = useRef(1);
  const lastTranslateRef = useRef({ x: 0, y: 0 });
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const baseTranslateX = useRef(new Animated.Value(0)).current;
  const baseTranslateY = useRef(new Animated.Value(0)).current;
  const panTranslateX = useRef(new Animated.Value(0)).current;
  const panTranslateY = useRef(new Animated.Value(0)).current;
  const scale = Animated.multiply(baseScale, pinchScale);
  const translateX = Animated.add(baseTranslateX, panTranslateX);
  const translateY = Animated.add(baseTranslateY, panTranslateY);

  const immersiveAnim = useRef(new Animated.Value(0)).current;

  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const tapRef = useRef(null);

  const resetTransform = () => {
    lastScaleRef.current = 1;
    lastTranslateRef.current = { x: 0, y: 0 };
    baseScale.setValue(1);
    pinchScale.setValue(1);
    baseTranslateX.setValue(0);
    baseTranslateY.setValue(0);
    panTranslateX.setValue(0);
    panTranslateY.setValue(0);
    setIsZoomed(false);
  };

  // 開くたびに(別の写真かもしれないので)拡大・移動・没入表示の状態をリセットする
  useEffect(() => {
    if (visible) {
      setImmersive(false);
      immersiveAnim.setValue(0);
      resetTransform();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, photoUri]);

  useEffect(() => {
    Animated.timing(immersiveAnim, {
      toValue: immersive ? 1 : 0,
      duration: IMMERSIVE_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [immersive, immersiveAnim]);

  const onPinchGestureEvent = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: true }
  );

  const onPinchHandlerStateChange = (
    event: HandlerStateChangeEvent<PinchGestureHandlerEventPayload>
  ) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      const next = clamp(lastScaleRef.current * event.nativeEvent.scale, MIN_SCALE, MAX_SCALE);
      lastScaleRef.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
      setIsZoomed(next > 1);
      if (next <= 1) {
        lastTranslateRef.current = { x: 0, y: 0 };
        baseTranslateX.setValue(0);
        baseTranslateY.setValue(0);
      }
    }
  };

  const onPanGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: panTranslateX, translationY: panTranslateY } }],
    { useNativeDriver: true }
  );

  const onPanHandlerStateChange = (
    event: HandlerStateChangeEvent<PanGestureHandlerEventPayload>
  ) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      lastTranslateRef.current = {
        x: lastTranslateRef.current.x + event.nativeEvent.translationX,
        y: lastTranslateRef.current.y + event.nativeEvent.translationY,
      };
      baseTranslateX.setValue(lastTranslateRef.current.x);
      baseTranslateY.setValue(lastTranslateRef.current.y);
      panTranslateX.setValue(0);
      panTranslateY.setValue(0);
    }
  };

  const onTapHandlerStateChange = (event: HandlerStateChangeEvent<Record<string, unknown>>) => {
    if (event.nativeEvent.state === State.ACTIVE) {
      setImmersive((prev) => !prev);
    }
  };

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
      {visible ? (
        <View style={styles.root}>
          <View style={styles.backdrop} />
          <Animated.View
            pointerEvents="none"
            style={[styles.backdrop, styles.backdropImmersive, { opacity: immersiveAnim }]}
          />
          <TapGestureHandler
            ref={tapRef}
            numberOfTaps={1}
            onHandlerStateChange={onTapHandlerStateChange}
          >
            <Animated.View style={styles.imageWrap}>
              <PanGestureHandler
                ref={panRef}
                enabled={isZoomed}
                simultaneousHandlers={pinchRef}
                onGestureEvent={onPanGestureEvent}
                onHandlerStateChange={onPanHandlerStateChange}
              >
                <Animated.View style={styles.imageWrap}>
                  <PinchGestureHandler
                    ref={pinchRef}
                    simultaneousHandlers={panRef}
                    onGestureEvent={onPinchGestureEvent}
                    onHandlerStateChange={onPinchHandlerStateChange}
                  >
                    <Animated.View style={styles.imageWrap}>
                      {photoUri ? (
                        <Animated.Image
                          source={{ uri: photoUri }}
                          resizeMode="contain"
                          style={[styles.image, { transform: [{ translateX }, { translateY }, { scale }] }]}
                        />
                      ) : null}
                    </Animated.View>
                  </PinchGestureHandler>
                </Animated.View>
              </PanGestureHandler>
            </Animated.View>
          </TapGestureHandler>
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
      ) : null}
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
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
