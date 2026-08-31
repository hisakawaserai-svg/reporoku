import { useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import type { RootStackParamList } from "../navigation/RootNavigator";
import { setOnboardingCompleted } from "../utils/settings";
import { fontSize } from "../theme/typography";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Phase = "intro" | "consent" | "permission";

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
};

const SLIDES: Slide[] = [
  {
    icon: "mic-outline",
    title: "話した内容を、そのまま記録",
    description: "音声を認識してテキスト化し、ノートとして残します。",
  },
  {
    icon: "git-commit-outline",
    title: "★・写真・音声が1本のタイムラインに",
    description: "重要な発言に★を付けたり写真を挟んだりしながら、時系列でまとめて振り返れます。",
  },
  {
    icon: "cloud-offline-outline",
    title: "完全ローカルで動作、通信ゼロ",
    description: "録音も文字起こしもすべて端末内で完結します。データが外部に送信されることはありません。",
  },
];

// 初回起動時のオンボーディング。概要説明→注意事項への同意→マイク権限リクエストの3段階を
// 1画面の中でphase切り替えとして実装している(遷移をStackに増やさないため)
export default function OnboardingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [phase, setPhase] = useState<Phase>("intro");
  const [slideIndex, setSlideIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const handleIntroScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setSlideIndex(index);
  };

  const goToNextSlide = () => {
    if (slideIndex < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: SCREEN_WIDTH * (slideIndex + 1), animated: true });
    } else {
      setPhase("consent");
    }
  };

  const finishOnboarding = () => {
    setOnboardingCompleted(true);
    navigation.replace("MainTabs");
  };

  const handleRequestMicPermission = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      if (!result.granted) {
        Alert.alert(
          "マイクへのアクセスが許可されませんでした",
          "後で「設定」アプリからいつでも許可できます。",
          [{ text: "続ける", onPress: finishOnboarding }],
        );
        return;
      }
      finishOnboarding();
    } catch (e) {
      console.warn("[Onboarding] マイク権限のリクエストに失敗しました", e);
      finishOnboarding();
    }
  };

  if (phase === "consent") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.heading}>利用上の注意</Text>
          <View style={styles.noticeCard}>
            <Ionicons name="alert-circle-outline" size={22} color="#c98a00" style={styles.noticeIcon} />
            <Text style={styles.noticeText}>
              録音・撮影は、必ず主催者の許可やその場のルールに従ってください。
            </Text>
          </View>
          <View style={styles.noticeCard}>
            <Ionicons name="alert-circle-outline" size={22} color="#c98a00" style={styles.noticeIcon} />
            <Text style={styles.noticeText}>
              録音・撮影した内容の取り扱いは、利用者ご自身の責任となります。
            </Text>
          </View>
        </View>
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.85}
            onPress={() => setPhase("permission")}
          >
            <Text style={styles.primaryButtonText}>同意して始める</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "permission") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Ionicons name="mic" size={36} color="#06c" />
          </View>
          <Text style={styles.heading}>マイクへのアクセス</Text>
          <Text style={styles.subheading}>
            音声を認識してテキスト化するために、マイクへのアクセスを許可してください。
          </Text>
        </View>
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.85}
            onPress={handleRequestMicPermission}
          >
            <Text style={styles.primaryButtonText}>マイクへのアクセスを許可する</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleIntroScrollEnd}
        style={styles.slidesScroll}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <View style={styles.iconCircle}>
              <Ionicons name={slide.icon} size={36} color="#06c" />
            </View>
            <Text style={styles.heading}>{slide.title}</Text>
            <Text style={styles.subheading}>{slide.description}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dotsRow}>
        {SLIDES.map((slide, i) => (
          <View key={slide.title} style={[styles.dot, i === slideIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.85} onPress={goToNextSlide}>
          <Text style={styles.primaryButtonText}>次へ</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  slidesScroll: { flex: 1 },
  slide: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#eaf3ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  heading: { fontSize: fontSize.dialogHeading, fontWeight: "700", color: "#1c1c1e", textAlign: "center" },
  subheading: {
    fontSize: 14,
    color: "#8e8e93",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 20,
  },

  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#d1d1d6" },
  dotActive: { backgroundColor: "#06c", width: 16 },

  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff8ea",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    gap: 10,
  },
  noticeIcon: { marginTop: 1 },
  noticeText: { flex: 1, fontSize: 14, color: "#3c3c43", lineHeight: 20 },

  footer: { paddingHorizontal: 24, paddingBottom: 16 },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: "#06c",
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
