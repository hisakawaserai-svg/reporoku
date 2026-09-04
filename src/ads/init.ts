import mobileAds from "react-native-google-mobile-ads";

/** UMP 同意後に一度だけ呼ぶ。失敗してもアプリは動かす。 */
export function initAds(): void {
  mobileAds()
    .initialize()
    .catch((e) => {
      console.warn("[ads] initialize failed:", e);
    });
}
