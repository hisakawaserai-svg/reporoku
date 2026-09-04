/**
 * UMP(GDPR) + ATT の同意フローと、完了状態の共有。
 * オンボーディング完了後（または起動時に完了済みならすぐ）に gatherAdsConsentAndInit() を呼ぶ。
 */
import { useSyncExternalStore } from "react";
import {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  AdsConsentStatus,
} from "react-native-google-mobile-ads";

import { initAds } from "./init";

export interface AdsConsentState {
  ready: boolean;
  npa: boolean;
  privacyOptionsRequired: boolean;
}

let state: AdsConsentState = {
  ready: false,
  npa: false,
  privacyOptionsRequired: false,
};
const listeners = new Set<() => void>();

function publish(next: AdsConsentState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAdsConsent(): AdsConsentState {
  return useSyncExternalStore(subscribe, () => state);
}

let started = false;

export function gatherAdsConsentAndInit(): void {
  if (started) return;
  started = true;

  const run = async () => {
    let npa = false;
    let privacyOptionsRequired = false;
    try {
      const info = await AdsConsent.gatherConsent();
      privacyOptionsRequired =
        info.privacyOptionsRequirementStatus ===
        AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
      if (__DEV__) {
        console.log("[ads] gatherConsent:", JSON.stringify(info));
      }
      if (info.status === AdsConsentStatus.OBTAINED) {
        try {
          const choices = await AdsConsent.getUserChoices();
          npa = !choices.selectPersonalisedAds;
        } catch (e) {
          console.warn("[ads] getUserChoices failed, NPA fallback:", e);
          npa = true;
        }
      }
    } catch (e) {
      console.warn("[ads] gatherConsent failed, NPA fallback:", e);
      npa = true;
    }
    initAds();
    publish({ ready: true, npa, privacyOptionsRequired });
  };

  run();
}
