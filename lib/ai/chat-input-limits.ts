import type { UIMessage } from "ai";

/**
 * ストリーミング チャット の 入力 上限(監査)。
 *
 * career / interview / advisor の チャット は 設計上「回数無制限」で メータリング
 * 対象外(コア UX)だが、認証済み ユーザー が 巨大な messages 配列 を 送りつけて
 * Anthropic コスト を 無制限 に 消費 できる 状態 だった。件数 と 総 文字数 に 上限 を
 * 設けて、通常利用(数十往復・各数百〜数千字)は 一切 妨げず、明らかな 濫用 だけを
 * 弾く。上限超過 は 413 で 返し、UI 側で「会話をリセット」導線に落とす想定。
 */
export const MAX_CHAT_MESSAGES = 300;
export const MAX_CHAT_TOTAL_CHARS = 200_000;

/** messages が 入力 上限 を 超えて いれば true。 */
export function chatInputExceedsLimit(messages: UIMessage[]): boolean {
  if (messages.length > MAX_CHAT_MESSAGES) return true;
  let total = 0;
  for (const m of messages) {
    for (const part of m.parts ?? []) {
      if (part.type === "text") {
        total += (part as { text: string }).text.length;
        if (total > MAX_CHAT_TOTAL_CHARS) return true;
      }
    }
  }
  return false;
}
