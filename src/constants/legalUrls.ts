/** 設定・オンボーディングなどから開く公式ページ。 */
export const LEGAL_URLS = {
  terms: "https://hisakawaserai-svg.github.io/reporoku/terms.html",
  privacy: "https://hisakawaserai-svg.github.io/reporoku/privacy.html",
  support: "https://hisakawaserai-svg.github.io/reporoku/support.html",
} as const;

/** ストアの評価画面。設定の「評価する」から開く。App Store Connect の Apple ID は 6808242881。 */
export const STORE_REVIEW_URLS = {
  ios: "itms-apps://itunes.apple.com/app/viewContentsUserReviews/id6808242881?action=write-review",
  android: "market://details?id=com.sera.reporoku&showAllReviews=true",
} as const;
