import { createHash } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * 未認証 公開 endpoint 用 の 共通 レート 制限 ヘルパー。
 *
 * 監査 Batch 2 の H3 / H4 / M5 対策 で 導入。 Vercel サーバーレス は 並列 度 が
 * 上がる と 新規 lambda が スケール アウト し、 モジュール スコープ の Map で
 * 保持 する in-memory バケット が 事実上 バイパス される ため、 Supabase テーブル
 * `rate_limit_events` に イベント を 記録 して sliding window で 判定 する。
 *
 * ・呼び 出し 側 は namespace と identifier (ip / email など) を 渡す。
 * ・email など の PII は SHA-256 で ハッシュ 化 し テーブル に 平文 を 残さ ない。
 *   同 email で 集計 でき れば 目的 は 達 する ため、 逆引き 不要。
 * ・上限 超過 時 は success:false を 返し、 呼び 出し 側 は 429 を 返す 責務。
 */

type ConsumeInput = {
  namespace: string;
  identifier: string;
  windowSeconds: number;
  maxCount: number;
  /**
   * true の 場合 identifier を SHA-256 で ハッシュ 化 して キー に 使う。
   * PII (email など) を DB に 生 で 残さ ない ため。
   */
  hashIdentifier?: boolean;
};

type ConsumeResult = {
  ok: boolean;
  /** true = 上限 超過 で 拒否 */
  limited: boolean;
};

/**
 * sliding window で レート 制限 を チェック し、 通過 する なら 使用 履歴 を 記録。
 * DB エラー が 発生 した 場合 は 保守 的 に ok:true を 返す (機能 停止 を 避ける)。
 * 上限 超過 の 場合 は ok:false, limited:true。
 */
export async function consumeRateLimit(input: ConsumeInput): Promise<ConsumeResult> {
  const identifier = input.hashIdentifier
    ? createHash("sha256").update(input.identifier).digest("hex")
    : input.identifier;
  const bucketKey = `${input.namespace}:${identifier}`;

  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket_key: bucketKey,
      p_window_seconds: input.windowSeconds,
      p_max_count: input.maxCount,
    });
    if (error) {
      console.error("[rate-limit] consume_rate_limit RPC failed", {
        namespace: input.namespace,
        code: error.code,
        message: error.message,
      });
      // DB 側 の 一時 障害 で サービス 全体 が 止まる のは 避ける。
      // 攻撃 面 が 一時的 に 開く リスク は あるが、 通常 運用 では 稀。
      return { ok: true, limited: false };
    }
    if (data === false) {
      return { ok: false, limited: true };
    }
    return { ok: true, limited: false };
  } catch (err) {
    console.error("[rate-limit] unexpected", {
      namespace: input.namespace,
      name: err instanceof Error ? err.name : "unknown",
    });
    return { ok: true, limited: false };
  }
}

/**
 * リクエスト から クライアント IP を 抽出 する。 x-forwarded-for の 先頭 を 採用。
 * 直接 アクセス (開発 環境) で 取得 できない 場合 は "unknown"。
 */
export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}
