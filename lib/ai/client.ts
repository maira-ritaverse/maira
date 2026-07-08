import { anthropic } from "@ai-sdk/anthropic";

/**
 * Mairaで使用するClaudeモデルの定義
 *
 * 用途別にモデルを分けることで、コスト最適化が可能。
 * 例:複雑な推論 → Sonnet、軽い分類 → Haiku
 *
 * バージョンは @ai-sdk/anthropic の AnthropicMessagesModelId 型で
 * サポートされているエイリアスを使用する(常に最新版を指す)。
 */
export const MODELS = {
  // メインの会話モデル(全モジュール共通)
  CONVERSATION: "claude-sonnet-4-6",

  // 軽量タスク用(将来の最適化用に予約)
  LIGHT: "claude-haiku-4-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY が 未設定 です。 lib/ai/client.ts が Anthropic を 呼び出す 前 に、 Vercel / .env.local の 環境 変数 を 設定 して ください。",
    );
    this.name = "AnthropicNotConfiguredError";
  }
}

/**
 * ANTHROPIC_API_KEY が 設定 されて いる か 確認 する 起動時 検証。
 *
 * C1-5 修正 の 動機:
 *   従来 は getModel() が @ai-sdk/anthropic に 委譲 する だけ で、 API Key が
 *   欠落 して いる 場合 も 呼び出し 時 まで エラー が 出 なかった。 UI 側 で
 *   長い ロード → 500 エラー → 意味 不明 な message で ユーザー が 混乱 する
 *   の を 防ぐ ため、 明確 な 型 の エラー を 前 段 で 投げる。
 */
export function assertAnthropicConfigured(): void {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new AnthropicNotConfiguredError();
  }
}

/**
 * Anthropic プロバイダー の ファクトリー。
 *
 * ANTHROPIC_API_KEY は 環境 変数 から 自動 で 読み込ま れる。 サーバー サイド
 * (API Route / Server Action) から のみ 呼び出す こと。
 *
 * C1-5 修正: モデル 取得 前 に assertAnthropicConfigured() で 明示 検証 し、
 * 未設定 の 場合 は AnthropicNotConfiguredError を 投げる。
 *
 * 使用 例:
 *   import { getModel, MODELS } from "@/lib/ai/client";
 *   import { streamText } from "ai";
 *
 *   const result = streamText({
 *     model: getModel(MODELS.CONVERSATION),
 *     messages: [...],
 *   });
 */
export function getModel(modelId: ModelId) {
  assertAnthropicConfigured();
  return anthropic(modelId);
}
