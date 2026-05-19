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

/**
 * Anthropicプロバイダーのファクトリー
 *
 * ANTHROPIC_API_KEY は環境変数から自動で読み込まれる。
 * サーバーサイド(API Route / Server Action)からのみ呼び出すこと。
 *
 * 使用例:
 *   import { getModel, MODELS } from "@/lib/ai/client";
 *   import { streamText } from "ai";
 *
 *   const result = streamText({
 *     model: getModel(MODELS.CONVERSATION),
 *     messages: [...],
 *   });
 */
export function getModel(modelId: ModelId) {
  return anthropic(modelId);
}
