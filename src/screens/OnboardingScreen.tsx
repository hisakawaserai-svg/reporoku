import { useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Linking,
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
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import type { RootStackParamList } from "../navigation/RootNavigator";
import { LEGAL_URLS } from "../constants/legalUrls";
import { setOnboardingCompleted } from "../utils/settings";
import { gatherAdsConsentAndInit } from "../ads/consent";
import { fontSize } from "../theme/typography";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Phase = "intro" | "consent" | "permission";

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  descriptionKey: string;
};

const SLIDES: Slide[] = [
  {
    icon: "mic-outline",
    titleKey: "onboarding.slides.record.title",
    descriptionKey: "onboarding.slides.record.description",
  },
  {
    icon: "git-commit-outline",
    titleKey: "onboarding.slides.timeline.title",
    descriptionKey: "onboarding.slides.timeline.description",
  },
  {
    icon: "cloud-offline-outline",
    titleKey: "onboarding.slides.local.title",
    descriptionKey: "onboarding.slides.local.description",
  },
];

// 初回起動時のオンボーディング。概要説明→注意事項＋規約同意→マイク権限。
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [phase, setPhase] = useState<Phase>("intro");
  const [slideIndex, setSlideIndex] = useState(0);
  const [legalAgreed, setLegalAgreed] = useState(false);
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

  const openLegalUrl = (url: string, label: string) => {
    Linking.openURL(url).catch((e) => console.warn(`[Onboarding] ${label} URL failed`, e));
  };

  const finishOnboarding = () => {
    setOnboardingCompleted(true);
    gatherAdsConsentAndInit();
    navigation.replace("MainTabs");
  };

  const handleRequestMicPermission = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      if (!result.granted) {
        Alert.alert(
          t("onboarding.permission.deniedTitle"),
          t("onboarding.permission.deniedMessage"),
          [{ text: t("onboarding.permission.continue"), onPress: finishOnboarding }],
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
        <ScrollView
          style={styles.consentScroll}
          contentContainerStyle={styles.consentScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.heading}>{t("onboarding.consent.heading")}</Text>
          <View style={styles.noticeCard}>
            <Ionicons name="alert-circle-outline" size={22} color="#c98a00" style={styles.noticeIcon} />
            <Text style={styles.noticeText}>{t("onboarding.consent.notice1")}</Text>
          </View>
          <View style={styles.noticeCard}>
            <Ionicons name="alert-circle-outline" size={22} color="#c98a00" style={styles.noticeIcon} />
            <Text style={styles.noticeText}>{t("onboarding.consent.notice2")}</Text>
          </View>

          <View style={styles.legalLinks}>
            <TouchableOpacity
              style={styles.legalLinkRow}
              activeOpacity={0.7}
              onPress={() => openLegalUrl(LEGAL_URLS.terms, "terms")}
            >
              <Text style={styles.legalLinkText}>{t("settings.appInfo.terms")}</Text>
              <Ionicons name="open-outline" size={16} color="#06c" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.legalLinkRow}
              activeOpacity={0.7}
              onPress={() => openLegalUrl(LEGAL_URLS.privacy, "privacy")}
            >
              <Text style={styles.legalLinkText}>{t("settings.appInfo.privacyPolicy")}</Text>
              <Ionicons name="open-outline" size={16} color="#06c" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.checkboxRow}
            activeOpacity={0.7}
            onPress={() => setLegalAgreed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: legalAgreed }}
          >
            <Ionicons
              name={legalAgreed ? "checkbox" : "square-outline"}
              size={24}
              color={legalAgreed ? "#06c" : "#c7c7cc"}
            />
            <Text style={styles.checkboxLabel}>{t("onboarding.consent.legalCheckbox")}</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryButton, !legalAgreed && styles.primaryButtonDisabled]}
            activeOpacity={0.85}
            disabled={!legalAgreed}
            onPress={() => setPhase("permission")}
          >
            <Text style={styles.primaryButtonText}>{t("onboarding.consent.agreeButton")}</Text>
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
          <Text style={styles.heading}>{t("onboarding.permission.heading")}</Text>
          <Text style={styles.subheading}>{t("onboarding.permission.description")}</Text>
        </View>
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.85}
            onPress={handleRequestMicPermission}
          >
            <Text style={styles.primaryButtonText}>{t("onboarding.permission.allowButton")}</Text>
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
          <View key={slide.titleKey} style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <View style={styles.iconCircle}>
              <Ionicons name={slide.icon} size={36} color="#06c" />
            </View>
            <Text style={styles.heading}>{t(slide.titleKey)}</Text>
            <Text style={styles.subheading}>{t(slide.descriptionKey)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dotsRow}>
        {SLIDES.map((slide, i) => (
          <View key={slide.titleKey} style={[styles.dot, i === slideIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.85} onPress={goToNextSlide}>
          <Text style={styles.primaryButtonText}>{t("onboarding.nextButton")}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  consentScroll: { flex: 1 },
  consentScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
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

  legalLinks: {
    marginTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5ea",
    paddingTop: 8,
  },
  legalLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  legalLinkText: { fontSize: 16, color: "#06c", fontWeight: "600" },

  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 20,
  },
  checkboxLabel: { flex: 1, fontSize: 14, color: "#3c3c43", lineHeight: 20, paddingTop: 2 },

  footer: { paddingHorizontal: 24, paddingBottom: 16 },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: "#06c",
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonDisabled: { backgroundColor: "#c7c7cc" },
  primaryButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
