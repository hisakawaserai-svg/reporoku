import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { useTranslation } from "react-i18next";

import { MREC_SLOT_HEIGHT, MREC_UNIT_ID } from "../ads/config";
import { useAdsConsent } from "../ads/consent";
import { useRecordScreenFocused } from "../ads/recordScreenGate";

const MREC_W = 300;
const MREC_H = 250;

/**
 * まとめ画面用の中サイズ広告。
 * 写真カードと間違えないよう「広告」ラベル＋平坦な枠。角丸のメディア風にはしない。
 * 収録タブ表示中だけネイティブ広告を外す。
 */
export default function AdMrec() {
  const { t } = useTranslation();
  const recordScreenFocused = useRecordScreenFocused();
  const { ready, npa } = useAdsConsent();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const adsPaused = recordScreenFocused;

  useEffect(() => {
    if (adsPaused) {
      setLoaded(false);
      return;
    }
    setFailed(false);
  }, [adsPaused]);

  if (failed) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t("ads.label")}</Text>
      <View style={[styles.slot, !loaded && styles.slotEmpty]}>
        {ready && !adsPaused ? (
          <BannerAd
            unitId={MREC_UNIT_ID}
            size={BannerAdSize.MEDIUM_RECTANGLE}
            requestOptions={{ requestNonPersonalizedAdsOnly: npa }}
            onAdLoaded={() => setLoaded(true)}
            onAdFailedToLoad={(error) => {
              console.warn("[AdMrec] failed:", error.message);
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
    minHeight: MREC_SLOT_HEIGHT,
    alignItems: "center",
    marginVertical: 16,
    marginHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c7c7cc",
    backgroundColor: "#eaeaee",
  },
  label: {
    width: MREC_W,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    color: "#6c6c70",
    textAlign: "left",
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  slot: {
    width: MREC_W,
    height: MREC_H,
    alignItems: "center",
    justifyContent: "center",
  },
  slotEmpty: {
    backgroundColor: "#d8d8dc",
  },
});
