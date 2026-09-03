import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { TFunction } from "i18next";

export type PhotoSource = "camera" | "library";

export type PickImageResult =
  | { ok: true; uri: string }
  | { ok: false; reason: "denied" | "canceled" };

// カメラ撮影 or ライブラリ選択のどちらで写真を取るかを選んでもらう。
// 分岐は Alert(両OSで動く)に寄せ、ネイティブ ActionSheet は使わない。
export function promptPhotoSource(
  t: TFunction,
  onPick: (source: PhotoSource) => void
): void {
  Alert.alert(t("photoSource.title"), t("photoSource.message"), [
    { text: t("photoSource.camera"), onPress: () => onPick("camera") },
    { text: t("photoSource.library"), onPress: () => onPick("library") },
    { text: t("common.cancel"), style: "cancel" },
  ]);
}

// 選んだ手段で ImagePicker を開き、選ばれた画像の URI を返す。
// 永続化(persistPhotoFile)は呼び出し側で行う。
export async function pickImageUri(source: PhotoSource): Promise<PickImageResult> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: "denied" };
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.[0]?.uri) return { ok: false, reason: "canceled" };
    return { ok: true, uri: result.assets[0].uri };
  }

  // 写真のみ。動画は扱わない。
  // iOS の画像ピッカーは権限なしでも開ける場合があるが、Android では必要なので先に依頼する。
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: "denied" };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.7,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return { ok: false, reason: "canceled" };
  return { ok: true, uri: result.assets[0].uri };
}
