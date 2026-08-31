// アプリ全体で役割ごとに使う色をここに集約する。画面ごとに微妙に異なる16進数を
// 直接書かず、必ずここから参照することで「同じ役割なのに値がバラバラ」を防ぐ。
// 既に全画面で統一されていた質問用の紫(question)とプライマリ青(primary)を基準に、
// star/todo/dangerなど揺れていた色も1つの値に揃えてある。

// ★(重要)。多くの画面で使われていた#d98c00 / #fdf0dcに統一
// (RecordScreen/RecordCompleteScreenだけ#c98a00を使っていたのはここに揃える)
export const star = {
  accent: "#d98c00",
  background: "#fdf0dc",
};

// Todo(緑)。★・質問と同じく「アイコン色=バッジ背景の濃色=保存ボタン色」が揃うよう、
// #1f9254に統一(#34c759 / #2fa84fを使っていた箇所はここに揃える)
export const todo = {
  accent: "#1f9254",
  background: "#e0f7e6",
};

// 質問(紫)。元々全画面で統一されていたので、そのままトークン化するだけ
export const question = {
  accent: "#7c4dff",
  background: "#f2e8fc",
};

// プライマリ青。元々全画面で統一されていたので、そのままトークン化するだけ
export const primary = "#06c";

// 危険操作(赤)。ボタン・アイコンなど「押せる危険操作」を示す色と、本文中の
// 小さなエラーテキスト色は、視認性の要件が異なる別の役割として分けて持つ
export const danger = {
  // 削除・録音終了など、押せる危険操作のボタン/アイコン/バッジ色
  // (RecordScreenの録音終了ボタンだけ#e0342fを使っていたのはここに揃える)
  action: "#ff3b30",
  // 本文中の小さなエラーテキスト色
  text: "#c00",
};

// 行の区切り線。#c6c6c8を使っていた箇所は#e5e5eaに揃える
export const divider = "#e5e5ea";

// 検索バーの背景。NotesScreenだけ#ebebf0を使っていたのは#e5e5eaに揃える
export const searchBarBackground = "#e5e5ea";

// モーダルの暗幕(オーバーレイ)。役割によって明確に濃さを変える意図がある箇所は
// そのまま残しつつ、名前を付けて「なぜこの値なのか」が分かるようにする
export const overlay = {
  // 長押しメニュー(RowLongPressMenu)の背景。他の内容が薄く透けて見える程度の軽さ
  menu: "rgba(0,0,0,0.3)",
  // クイック追加・グループ設定・月選択など、カード型フォームモーダルの背景
  card: "rgba(0,0,0,0.4)",
  // メモ・デバッグパネルなど、内容が濃い画面の上に出す場合の背景
  // (0.3だと薄すぎて読みにくいという理由で0.55にした、という経緯がRecordScreen/
  // NoteDetailScreen両方のコメントに残っている)
  prompt: "rgba(0,0,0,0.55)",
  // 写真ビューアーなど、背景を完全に意識の外に追い出したい全画面表示の背景
  photoViewer: "rgba(0,0,0,0.75)",
};
