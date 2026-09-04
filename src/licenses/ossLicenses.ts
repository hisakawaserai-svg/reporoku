/**
 * `react-native-oss-license --json` の出力形。
 *
 * 注意: 依存を追加・削除・更新したら必ず `npm run licenses:generate` を実行し、
 * `src/generated/ossLicenses.json` をコミットすること（設定画面の一覧に反映される）。
 */
import raw from "../generated/ossLicenses.json";

export type OssLicenseEntry = {
  libraryName: string;
  version?: string;
  _license?: string;
  _description?: string;
  homepage?: string;
  _licenseContent?: string;
};

export const OSS_LICENSES = raw as OssLicenseEntry[];
