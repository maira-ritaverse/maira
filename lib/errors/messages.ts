/**
 * API エラー を ユーザー 向け 日本語 メッセージ に 変換 する ヘルパ。
 *
 * 従来 の 問題:
 *   fetch(url) で 500 が 返る と、 コード が `throw new Error("HTTP 500")` or
 *   `throw new Error("Unknown error")` を そのまま UI に 出して いた。
 *   ユーザー は 「何 を どう すれば 直る か」 が わから ない。
 *
 * 方針:
 *   ・エラー コード (`invalid_body` / `forbidden` / `not_found` 等) に 対して
 *     決まった 日本語 文言 を 返す
 *   ・未知 の コード は 「通信 に 失敗 しました。 少し 待って から お試し ください」
 *     の 汎用 メッセージ に 倒す (dev 詳細 は 出さない)
 *   ・fetch ラッパ apiRequest() は body から error / message を 拾って 上記 に かける
 *
 * 使い方 (client component):
 *   import { apiRequest } from "@/lib/errors/messages";
 *
 *   try {
 *     await apiRequest("/api/agency/jobs", { method: "POST", body: JSON.stringify(data) });
 *     showToast("success", "保存しました");
 *   } catch (e) {
 *     showToast("error", errorToJapanese(e));
 *   }
 */

/**
 * 既知 の API エラー コード → 日本語 文言。
 * 追加 した ければ ここ に 一 行 追加 する だけ で OK。
 */
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "ログインが 必要です。 再度 ログインして ください。",
  forbidden: "この 操作は 許可されて いません。 管理者に お問い合わせください。",
  admin_only: "管理者 のみ が 操作 できます。",
  not_found: "対象の データが 見つかりません でした。 削除された 可能性が あります。",
  archived: "このアカウントは 停止 されて います。 管理者に お問い合わせください。",
  organization_archived: "この組織は 停止 されて います。 管理者に お問い合わせください。",
  invalid_body: "入力内容に 誤りが あります。 各項目を 確認して ください。",
  invalid_request: "リクエストに 誤りが あります。 少し 待ってから お試し ください。",
  upsert_failed: "保存に 失敗 しました。 少し 待って から お試し ください。",
  server_error: "サーバー側で エラーが 起きました。 少し 待って から お試し ください。",
  rate_limited: "短時間に 何度も 実行 されました。 少し 待って から お試し ください。",
  quota_exceeded: "今月の 利用回数上限に 達しました。 管理者に お問い合わせください。",
  plan_read_only:
    "このプランでは 書き込み 操作が できません。 プランを アップグレード して ください。",
  encryption_failed: "データの 暗号化 に 失敗 しました。 サポート に お問い合わせください。",
};

/**
 * デフォルト の 汎用 メッセージ。
 * 未知 の エラー コード / HTTP エラー / ネットワーク エラー すべて これ に 倒す。
 */
export const DEFAULT_ERROR_MESSAGE =
  "通信に 失敗 しました。 少し 待って から お試し ください。 直らない ときは サポート に お問い合わせください。";

/**
 * エラー コード ↔ 日本語 の 変換。 コード が 未知 なら DEFAULT_ERROR_MESSAGE。
 */
export function codeToJapanese(code: string | null | undefined): string {
  if (!code) return DEFAULT_ERROR_MESSAGE;
  return KNOWN_ERROR_MESSAGES[code] ?? DEFAULT_ERROR_MESSAGE;
}

/**
 * catch した エラー オブジェクト を 日本語 メッセージ に 変換 する。
 *   ・ApiError なら stored message を そのまま (すでに 日本語 化 済)
 *   ・それ 以外 は DEFAULT_ERROR_MESSAGE
 * ネットワーク 例外 (TypeError: Failed to fetch 等) も 汎用 メッセージ に 倒す。
 */
export function errorToJapanese(e: unknown): string {
  if (e instanceof ApiError) return e.userMessage;
  return DEFAULT_ERROR_MESSAGE;
}

/**
 * fetch 応答 の 内側 で 発生 した API エラー。
 * `userMessage` は UI に そのまま 出せる 日本語。
 * `code` は デバッグ 用 に 生 の エラー コード を 保持 (Sentry 等 に 送る 用途)。
 */
export class ApiError extends Error {
  readonly code: string | null;
  readonly status: number;
  readonly userMessage: string;

  constructor(args: { code: string | null; status: number; userMessage: string }) {
    super(args.userMessage);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status;
    this.userMessage = args.userMessage;
  }
}

/**
 * fetch ラッパ。 200 系 なら response を そのまま 返す。
 * 400+ なら body の error / message を 拾って ApiError を throw する。
 *
 * ・body が JSON で ない (HTML の 500 ページ 等) 場合 は status のみ で 汎用 に 倒す
 * ・network 例外 は Error のまま (呼び出し 側 で errorToJapanese する)
 */
export async function apiRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.ok) return res;

  let code: string | null = null;
  let serverMessage: string | null = null;
  try {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    code = body?.error ?? null;
    serverMessage = body?.message ?? null;
  } catch {
    // body が JSON で ない 場合 は 無視 (status だけ で 判断)
  }

  const userMessage = codeToJapanese(code);
  throw new ApiError({
    code,
    status: res.status,
    // 未知 code だが server が 説明 文 を くれて いる 場合 は それ を 優先 (管理者向け UI 等)。
    // 但し 「Unknown error」 「HTTP 500」 の ような 開発者 ジャーゴン は 出さ ない。
    userMessage:
      code == null && serverMessage && !/^HTTP\s|unknown/i.test(serverMessage)
        ? serverMessage
        : userMessage,
  });
}
