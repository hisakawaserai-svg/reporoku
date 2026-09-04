/**
 * 広告ユニットIDとテスト設定の一元管理。
 *
 * __DEV__ では本番IDを使わず Google のテストIDにする（無効トラフィック対策）。
 * 本番IDは AdMob 管理画面で発行したら下の PROD_* に入れる。空ならテストIDのまま。
 *
 * アプリID（ca-app-pub-XXX~YYY）は app.json のプラグイン側。ここはユニットID（/ 区切り）だけ。
 */
import { Platform } from "react-native";
import { TestIds } from "react-native-google-mobile-ads";

const PROD_BANNER_UNIT_ID = Platform.select({
  ios: "ca-app-pub-3194046005390900/7861593932",
  android: "ca-app-pub-3194046005390900/3730777237",
  default: "",
}) as string;

const PROD_MREC_UNIT_ID = Platform.select({
  ios: "ca-app-pub-3194046005390900/6581030809",
  android: "ca-app-pub-3194046005390900/5750435914",
  default: "",
}) as string;

const PROD_INTERSTITIAL_UNIT_ID = Platform.select({
  ios: "ca-app-pub-3194046005390900/2549557504",
  android: "ca-app-pub-3194046005390900/2801567894",
  default: "",
}) as string;

export const BANNER_UNIT_ID =
  __DEV__ || !PROD_BANNER_UNIT_ID ? TestIds.ADAPTIVE_BANNER : PROD_BANNER_UNIT_ID;

export const MREC_UNIT_ID =
  __DEV__ || !PROD_MREC_UNIT_ID ? TestIds.BANNER : PROD_MREC_UNIT_ID;

export const INTERSTITIAL_UNIT_ID =
  __DEV__ || !PROD_INTERSTITIAL_UNIT_ID
    ? TestIds.INTERSTITIAL
    : PROD_INTERSTITIAL_UNIT_ID;

/**
 * アダプティブバナー用の下限高さ（ラベル込み）。
 * 実サイズは画面幅に応じて SDK が決める（最大おおよそ 90dp + ラベル）。
 */
export const BANNER_SLOT_MIN_HEIGHT = 64;

/** MREC 300×250 + ラベル。写真カードと見た目を揃えない。 */
export const MREC_SLOT_HEIGHT = 280;
