/**
 * Claude の出力テキストから JSON オブジェクトを取り出すヘルパー(純関数)
 *
 * LLM は時々:
 *   - "```json\n{...}\n```" のようにコードフェンスで包む
 *   - "以下が結果です:\n{...}" のように前置きを付ける
 *   - 末尾に説明文を付ける
 *
 * 厳密ではないが「コードフェンス除去 → 先頭 { から最後の } まで切り出し」で
 * 実用上ほぼ拾えるので、本ヘルパーで吸収する。JSON.parse 失敗時は
 * 呼び出し側が原文を保持してログに出すこと。
 */
export function extractJsonFromText(text: string): string {
  // コードフェンス("```json ... ```" or "``` ... ```")の中身を優先
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 最初の { から最後の } までを切り出す(雑だが実用)
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}
