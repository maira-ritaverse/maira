/**
 * クライアント側 fetch のヘルパ(エラー形状の統一)
 *
 * 既存のコンポーネントで何度も書いていた次のパターンを集約:
 *
 *   const res = await fetch("/api/...", { method: "POST", ... });
 *   const json = (await res.json().catch(() => ({}))) as { error?: string };
 *   if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
 *
 * このヘルパは:
 *   - JSON body 自動シリアライズ(Content-Type も自動)
 *   - 失敗時は ApiClientError(message + status + serverError)を throw
 *   - 成功時は JSON をパースして T として返す(なければ undefined)
 *
 * 既存コードは段階的に置き換える前提。一気に書き換えない。
 */

export class ApiClientError extends Error {
  status: number;
  serverError: string | undefined;
  /** サーバから返ってきた JSON ボディ(あれば)。クォータ情報など status 以外のメタを読むため。 */
  body: unknown;

  constructor(
    message: string,
    opts: { status: number; serverError?: string; body?: unknown } = { status: 0 },
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = opts.status;
    this.serverError = opts.serverError;
    this.body = opts.body;
  }
}

type ApiFetchOptions = Omit<RequestInit, "body"> & {
  /** JSON にシリアライズして送る。undefined なら body 無し */
  json?: unknown;
};

/**
 * 共通 API 呼び出し。レスポンスを T 型としてパースして返す。
 * - 2xx 以外なら ApiClientError を throw
 * - レスポンスボディが JSON でない / 空なら undefined を返す
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T | undefined> {
  const { json, headers, ...rest } = options;
  const init: RequestInit = { ...rest, headers: { ...(headers ?? {}) } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    };
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiClientError(err instanceof Error ? `通信エラー: ${err.message}` : "通信エラー", {
      status: 0,
    });
  }

  // ボディ取得を 1 回だけ(成功 / 失敗どちらでもパース失敗をフォールバック)
  const text = await res.text().catch(() => "");
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // text のまま扱う
      parsed = text;
    }
  }

  if (!res.ok) {
    const serverError =
      (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)
        ? String((parsed as Record<string, unknown>).error)
        : undefined) ?? (typeof parsed === "string" ? parsed : undefined);
    throw new ApiClientError(serverError ?? `HTTP ${res.status}`, {
      status: res.status,
      serverError,
      body: parsed,
    });
  }

  return parsed as T | undefined;
}

/**
 * 生の英語エラー文字列 → 日本語に翻訳する小さな辞書。
 *
 * 経緯:
 *   API ルートは 230 箇所以上で NextResponse.json({ error: "Unauthorized" }) などの
 *   英語キーワードを返している。これを一律に日本語化する移行が完了するまでは、
 *   表示直前(クライアント)で機械的に置換してユーザーに英語が露出しないようにする。
 *   サーバ側で日本語化された箇所はそのまま素通しでよい。
 */
const SERVER_ERROR_JA: Record<string, string> = {
  Unauthorized: "ログインが必要です",
  Forbidden: "この操作を行う権限がありません",
  "Admin only": "管理者のみ操作できます",
  "Invalid JSON body": "リクエスト形式が正しくありません",
  "Bad Request": "リクエスト内容に誤りがあります",
  "Not found": "対象が見つかりません",
  "Internal Server Error": "サーバーエラーが発生しました。しばらくしてから再度お試しください",
  "Method not allowed": "この方法ではアクセスできません",
  archived: "このアカウントは現在利用を停止しています",
  organization_archived: "この組織は退会済のため操作できません",
};

/** サーバから来た英語エラーを日本語にマップする。マッチしなければ元の文字列を返す。 */
function translateServerError(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return SERVER_ERROR_JA[raw] ?? raw;
}

/**
 * エラーをまとめてユーザ表示用の文字列にする小さなヘルパ。
 * react-hook-form / useState(error) でそのまま使いたいケース用。
 *
 * 上記の翻訳辞書を経由してから返すため、API 側が英語キーワードを返していても
 * UI 表示は日本語になる。
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    return translateServerError(err.serverError) ?? err.message;
  }
  if (err instanceof Error) return translateServerError(err.message) ?? err.message;
  return "不明なエラー";
}
