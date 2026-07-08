/**
 * AI生成エラーの分類とユーザー向けメッセージへの変換
 *
 * Anthropic API / AI SDK が投げるエラーをカテゴリに分け、
 * ユーザーに見せる文言と「再試行できるか」を返す。
 * 技術的詳細はユーザー向け文言には含めない(秘密漏洩防止)。
 */

export type AIErrorCategory =
  | "not_configured" // ANTHROPIC_API_KEY 未設定 (C1-5)
  | "rate_limit" // 429: リクエスト 過多
  | "auth" // 401: API Key 失効 等
  | "input_too_long" // 400: トークン 上限 超過
  | "policy" // 400: Usage Policy 違反
  | "server_error" // 5xx: Anthropic 側 障害
  | "network" // ネットワーク 到達 不能
  | "timeout" // 応答 タイム アウト
  | "unknown"; // 分類 不能

export type AIErrorInfo = {
  category: AIErrorCategory;
  userMessage: string;
  retryable: boolean;
};

/**
 * エラーオブジェクトを分類してユーザー向け情報を返す
 *
 * 使用例(API Route内):
 *   try {
 *     // streamText(...) など
 *   } catch (err) {
 *     const info = categorizeAIError(err);
 *     return NextResponse.json(
 *       { error: info.userMessage, category: info.category, retryable: info.retryable },
 *       { status: aiErrorToStatusCode(info.category) },
 *     );
 *   }
 */
export function categorizeAIError(error: unknown): AIErrorInfo {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : "";
  const lowerMessage = errorMessage.toLowerCase();

  // C1-5: ANTHROPIC_API_KEY 未設定 は 認証 エラー と 別枠 で 分類。
  // 運用 側 に 「本番 env 未設定」 と 「Key 失効」 を 区別 させたい。
  if (errorName === "AnthropicNotConfiguredError") {
    return {
      category: "not_configured",
      userMessage:
        "AI サービス の 設定 が 完了 して い ません。 運営 側 で 設定 が 必要 です。 サポート に お問い合わせ ください。",
      retryable: false,
    };
  }

  // レート 制限 (429)
  if (lowerMessage.includes("rate") && lowerMessage.includes("limit")) {
    return {
      category: "rate_limit",
      userMessage: "リクエストが多すぎます。少し時間を置いてから再度お試しください。",
      retryable: true,
    };
  }

  // 認証エラー(API Key失効など)
  if (
    lowerMessage.includes("api key") ||
    lowerMessage.includes("authentication") ||
    lowerMessage.includes("unauthorized")
  ) {
    return {
      category: "auth",
      userMessage: "AIサービスへの接続に問題が発生しました。サポートにお問い合わせください。",
      retryable: false,
    };
  }

  // 入力長エラー(トークン上限超過)
  if (lowerMessage.includes("context") || lowerMessage.includes("token")) {
    return {
      category: "input_too_long",
      userMessage: "入力が長すぎます。内容を短くしてから再度お試しください。",
      retryable: false,
    };
  }

  // Usage Policy違反
  if (lowerMessage.includes("policy") || lowerMessage.includes("usage policy")) {
    return {
      category: "policy",
      userMessage: "申し訳ありません。この内容には対応できません。別の表現で再度お試しください。",
      retryable: false,
    };
  }

  // タイムアウト
  if (lowerMessage.includes("timeout") || errorName === "TimeoutError") {
    return {
      category: "timeout",
      userMessage: "AI応答に時間がかかりすぎました。再度お試しください。",
      retryable: true,
    };
  }

  // ネットワーク
  if (
    lowerMessage.includes("network") ||
    lowerMessage.includes("fetch") ||
    errorName === "NetworkError"
  ) {
    return {
      category: "network",
      userMessage: "通信エラーが発生しました。接続を確認してから再度お試しください。",
      retryable: true,
    };
  }

  // サーバーエラー(5xx)
  if (
    lowerMessage.includes("internal server") ||
    lowerMessage.includes("server error") ||
    lowerMessage.includes("503") ||
    lowerMessage.includes("502") ||
    lowerMessage.includes("500")
  ) {
    return {
      category: "server_error",
      userMessage:
        "AIサービスで一時的な問題が発生しています。少し時間を置いてから再度お試しください。",
      retryable: true,
    };
  }

  return {
    category: "unknown",
    userMessage:
      "予期せぬエラーが発生しました。再度お試しいただくか、続く場合はサポートにご連絡ください。",
    retryable: true,
  };
}

/**
 * AIエラーのカテゴリから HTTP ステータスコードへ変換
 *
 * - auth は外部に「API Key失効」を漏らさないため 503(サービス利用不可)として返す
 * - 一時的な障害は 502(Bad Gateway)で「上流が原因」を示す
 */
export function aiErrorToStatusCode(category: AIErrorCategory): number {
  switch (category) {
    case "rate_limit":
      return 429;
    case "not_configured":
    case "auth":
      return 503;
    case "input_too_long":
    case "policy":
      return 400;
    case "server_error":
    case "network":
    case "timeout":
      return 502;
    case "unknown":
    default:
      return 500;
  }
}
