/**
 * LINE Messaging API エラー の 分類 + 日本語 メッセージ 化。
 *
 * LINE は エラー を 次 の よう に 返す:
 *   - HTTP 429:rate limit (秒間 / 分間 上限)
 *   - HTTP 403 + message="The number of messages..." : 月次 課金通数 上限 超過
 *   - HTTP 400 + 各種:不正 リクエスト
 *   - HTTP 401:Access Token 無効
 *
 * 公式: https://developers.line.biz/ja/docs/messaging-api/troubleshooting/
 */

export type LineErrorKind =
  | "quota_exceeded" // 月次 課金通数 上限 (プラン UP / 翌月 待ち)
  | "rate_limit" // 秒/分 単位 の レート 制限 (リトライ で 復活)
  | "unauthorized" // Token 失効
  | "user_blocked" // 友達 解除 / ブロック
  | "invalid_message" // メッセージ 構造 不正
  | "network" // ネットワーク 失敗
  | "unknown";

export type LineErrorClass = {
  kind: LineErrorKind;
  /** 日本語 短文 (UI に そのまま 出せる) */
  message: string;
  /** 詳細 説明 (アラート 内 等) */
  hint: string;
  /** 自動 リトライ 可能 か */
  retryable: boolean;
};

export function classifyLineError(status: number, body: string): LineErrorClass {
  const text = body.toLowerCase();

  // 月次 上限 超過 (LINE 公式 アカウント の プラン 通数 を 使い切った)
  if (
    text.includes("monthly limit") ||
    text.includes("the number of messages") ||
    text.includes("exceeded the monthly")
  ) {
    return {
      kind: "quota_exceeded",
      message: "LINE 月次 配信 上限 に 達しました",
      hint: "LINE Official Account Manager で プラン を 上げる か、 翌月 1 日 の リセット を 待って ください。",
      retryable: false,
    };
  }

  // Rate limit (秒間 / 分間 単位)
  if (status === 429) {
    return {
      kind: "rate_limit",
      message: "LINE API の レート 制限 (短時間 で 多すぎ)",
      hint: "数 秒 待って 再送 して ください。 通常 自動 リトライ で 解消 します。",
      retryable: true,
    };
  }

  // Token 失効
  if (status === 401) {
    return {
      kind: "unauthorized",
      message: "LINE Access Token が 無効 です",
      hint: "設定 ページ で 「自動セットアップ を 再実行」 → 検証 OK を 確認 して ください。",
      retryable: false,
    };
  }

  // 友達 解除 / 個人 配信 不可
  if (
    text.includes("not a friend") ||
    text.includes("blocked") ||
    text.includes("the user hasn't added")
  ) {
    return {
      kind: "user_blocked",
      message: "求職者 が ブロック / 友達 解除 して います",
      hint: "Maira 側 でも 該当 友達 を 解除 済 に マーク します。 連携 が 必要 です。",
      retryable: false,
    };
  }

  // 400 系
  if (status === 400) {
    return {
      kind: "invalid_message",
      message: "LINE が メッセージ を 受理 しませんでした",
      hint: body.slice(0, 200),
      retryable: false,
    };
  }

  // 0 = fetch 自体 失敗
  if (status === 0) {
    return {
      kind: "network",
      message: "LINE に 到達 できませんでした",
      hint: "ネットワーク 不安定 か LINE 側 障害 の 可能性。 時間 を 置いて 再送 して ください。",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    message: `LINE エラー (HTTP ${status})`,
    hint: body.slice(0, 200),
    retryable: false,
  };
}

/**
 * 配信 結果 配列 から エラー サマリ を 集計 (UI 表示 用)。
 */
export function summarizeSendResults(
  results: Array<{ ok: boolean; error?: string; errorClass?: LineErrorClass }>,
): {
  sent: number;
  failed: number;
  byKind: Partial<Record<LineErrorKind, number>>;
  topMessage: string | null;
} {
  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  const byKind: Partial<Record<LineErrorKind, number>> = {};
  for (const r of results) {
    if (r.ok || !r.errorClass) continue;
    byKind[r.errorClass.kind] = (byKind[r.errorClass.kind] ?? 0) + 1;
  }

  // 最頻 エラー の メッセージ を 代表 値 と する
  let topKind: LineErrorKind | null = null;
  let topCount = 0;
  for (const [k, c] of Object.entries(byKind)) {
    if ((c ?? 0) > topCount) {
      topCount = c ?? 0;
      topKind = k as LineErrorKind;
    }
  }
  const topMessage =
    topKind && topCount > 0
      ? (results.find((r) => !r.ok && r.errorClass?.kind === topKind)?.errorClass?.message ?? null)
      : null;

  return { sent, failed, byKind, topMessage };
}
