let counter = 0;

// SQLiteの主キー用に一意な文字列IDを生成する(乱数+単調カウンタ+時刻)
export function genId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
