import { useEffect, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { useTranslation } from "react-i18next";

import { BANNER_SLOT_MIN_HEIGHT, BANNER_UNIT_ID } from "../ads/config";
import { useAdsConsent } from "../ads/consent";
import { useRecordScreenFocused } from "../ads/recordScreenGate";
import * as colors from "../theme/colors";

/**
 * タブ直上のアダプティブバナー。「広告」ラベル付き。同意完了までリクエストしない。
 * 収録タブ表示中だけネイティブ広告を外す（他画面の切替では外さない）。
 */
export default function AdBanner() {
  const { t } = useTranslation();
  const adsPaused = useRecordScreenFocused();
  const { width: windowWidth } = useWindowDimensions();
  const { ready, npa } = useAdsConsent();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (adsPaused) {
      setLoaded(false);
      return;
    }
    // 収録タブから戻ったら再試行できるようにする
    setFailed(false);
  }, [adsPaused]);

  if (failed) return null;

  const showBanner = ready && !adsPaused;

  return (
    <View style={[styles.wrap, { width: windowWidth }]}>
      <Text style={styles.label}>{t("ads.label")}</Text>
      <View style={[styles.slot, { width: windowWidth }, !loaded && styles.slotEmpty]}>
        {showBanner ? (
          <BannerAd
            unitId={BANNER_UNIT_ID}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: npa }}
            onAdLoaded={() => setLoaded(true)}
            onAdFailedToLoad={(error) => {
              console.warn("[AdBanner] failed:", error.message);
              setFailed(true);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: BANNER_SLOT_MIN_HEIGHT,
    alignItems: "stretch",
    justifyContent: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: 2,
    paddingBottom: 0,
    backgroundColor: "#f2f2f7",
    flexShrink: 0,
    alignSelf: "stretch",
  },
  label: {
    paddingHorizontal: 8,
    fontSize: 10,
    lineHeight: 12,
    color: "#8e8e93",
    textAlign: "left",
  },
  slot: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slotEmpty: {
    backgroundColor: "#e5e5ea",
  },
});
