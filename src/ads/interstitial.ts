/**
 * 収録完了後のインタースティシャル。
 * 失敗・未ロードでも必ず onDone を呼び、遷移を止めない。
 */
import {
  AdEventType,
  InterstitialAd,
} from "react-native-google-mobile-ads";

import { INTERSTITIAL_UNIT_ID } from "./config";

type Listener = () => void;

let interstitial: InterstitialAd | null = null;
let loaded = false;
let loading = false;

function ensureAd(npa: boolean): InterstitialAd {
  if (!interstitial) {
    interstitial = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
      requestNonPersonalizedAdsOnly: npa,
    });
    interstitial.addAdEventListener(AdEventType.LOADED, () => {
      loaded = true;
      loading = false;
    });
    interstitial.addAdEventListener(AdEventType.ERROR, () => {
      loaded = false;
      loading = false;
    });
    interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      loaded = false;
      // 次回用に先読み
      preloadInterstitial(npa);
    });
  }
  return interstitial;
}

export function preloadInterstitial(npa: boolean): void {
  const ad = ensureAd(npa);
  if (loaded || loading) return;
  loading = true;
  ad.load();
}

/**
 * 表示できれば表示し、閉じた／失敗したら onDone。
 * 同意前や未ロードならすぐ onDone。
 */
export function showInterstitialThen(npa: boolean, onDone: Listener): void {
  const ad = ensureAd(npa);
  if (!loaded) {
    onDone();
    if (!loading) preloadInterstitial(npa);
    return;
  }

  const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
    unsubClosed();
    unsubError();
    onDone();
  });
  const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
    unsubClosed();
    unsubError();
    onDone();
  });

  try {
    ad.show();
    loaded = false;
  } catch (e) {
    console.warn("[ads] interstitial show failed:", e);
    unsubClosed();
    unsubError();
    onDone();
  }
}
