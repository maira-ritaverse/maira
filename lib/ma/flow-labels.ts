/**
 * Flow の表示ラベル・日付フォーマット。
 *
 * Flow 一覧カードと Flow 編集ヘッダーの両方から使うため lib 側に集約。
 * 開発者向けの内部キー(friend_added / tag_assigned など)をそのまま UI に
 * 出さないようにするための翻訳表を含む。
 */

/** trigger_type(内部キー)→ 利用者向けの日本語ラベル */
export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  friend_added: "友だち追加時",
  tag_assigned: "タグが付いたとき",
  tag_removed: "タグが外れたとき",
  segment_matched: "セグメント一致時",
  form_submitted: "フォーム送信時",
  postback_received: "ボタンタップ時",
  keyword_matched: "キーワード反応時",
  conversion_event: "目標達成時",
  manual: "手動",
};

export function labelForTriggerType(key: string | null | undefined): string {
  if (!key) return "未設定";
  return TRIGGER_TYPE_LABELS[key] ?? key;
}

/** ISO 文字列 → 「2026年7月12日」形式 */
export function formatUpdatedAtJa(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
