// borderRadius・padding/marginの共通値をここに集約する。役割ごとに10/12/14/18/20など
// 微妙に異なる数値が画面ごとに散らばっていたのを、ここから参照する形に揃える。

export const radius = {
  // 一覧のカード・行(Settings/Report/StorageManagement/Notes/Summaryの各カード・行)。
  // 10/12/14と揺れていたのを1つに揃える
  card: 12,
  // 入力フォーム型のカード(InlineEditCard/GroupSettingForm/SummaryScreenのモーダル)。
  // 「同じ見た目に揃えている」とコメントされていたのにGroupSettingFormだけ20だったのを、
  // 本来の意図通り18に揃える
  formCard: 18,
  // バッジ・ピルなど完全な丸型
  pill: 999,
};

export const spacing = {
  // 画面全体の左右余白。NoteDetailScreenの一部だけ20になっていたのを16に揃える
  screenPadding: 16,
  // 一覧のカード・行の内側余白。12/14と揺れていたのを1つに揃える
  cardPadding: 12,
  // 入力フォーム型のカードの内側余白(InlineEditCard/GroupSettingForm/SummaryScreenのモーダル)
  formCardPadding: 20,
};
