import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * service_roleキーを使用したSupabaseクライアント
 *
 * 用途:
 * - Stripe Webhookからのsubscriptions更新
 * - サーバー側の管理操作(RLSをバイパスする必要がある場合のみ)
 *
 * 注意:
 * - 絶対にClient Componentで使わない(秘密キーが露出する)
 * - APIルートやServer Actionsの中でのみ使用する
 * - RLSをバイパスするため、使用には慎重な判断が必要
 */
export function createServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient() must not be called from the browser. " +
        "This would expose the service_role key.",
    );
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
