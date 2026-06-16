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
 * エラーをまとめてユーザ表示用の文字列にする小さなヘルパ。
 * react-hook-form / useState(error) でそのまま使いたいケース用。
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    return err.serverError ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "不明なエラー";
}
