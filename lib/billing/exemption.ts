/**
 * 組織 単位 の 「課金 免除」 フラグ の 読み 書き ヘルパー。
 *
 * - admin だけ が トグル できる ( アプリ 層 で 検証 )
 * - 課金 ロジック ( Stripe 連携 後 ) で isOrgBillingExempt を 評価 し、
 *   true なら 課金 を スキップ する 想定
 */
import { createServiceClient } from "@/lib/supabase/service";

export type BillingExemptionState = {
  isExempt: boolean;
  reason: string | null;
  setAt: string | null;
  setByUserId: string | null;
};

/**
 * 指定 組織 の 課金 免除 状態 を 取得。 organization_plans が 存在 しない 場合 は
 * 「免除 されて いない」 と 解釈 ( null safety )。
 */
export async function getBillingExemption(organizationId: string): Promise<BillingExemptionState> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("organization_plans")
    .select(
      "is_billing_exempt, billing_exempt_reason, billing_exempt_set_at, billing_exempt_set_by_user_id",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  return {
    isExempt: Boolean(data?.is_billing_exempt),
    reason: (data?.billing_exempt_reason as string | null) ?? null,
    setAt: (data?.billing_exempt_set_at as string | null) ?? null,
    setByUserId: (data?.billing_exempt_set_by_user_id as string | null) ?? null,
  };
}

/**
 * 課金 免除 を 設定 / 解除 する。 呼び出し 側 で admin 認証 を 済ませて おく こと。
 *
 * organization_plans 行 が ない 組織 ( = ま だ プラン 未 作成 ) でも、
 * is_billing_exempt = true に した い ケース は あり得る の で、 upsert で 作成 する。
 */
export async function setBillingExemption(args: {
  organizationId: string;
  isExempt: boolean;
  reason: string | null;
  actingUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createServiceClient();

  const now = new Date().toISOString();
  const { error } = await admin.from("organization_plans").upsert(
    {
      organization_id: args.organizationId,
      is_billing_exempt: args.isExempt,
      billing_exempt_reason: args.reason,
      billing_exempt_set_at: now,
      billing_exempt_set_by_user_id: args.actingUserId,
      updated_at: now,
    },
    { onConflict: "organization_id" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Stripe 課金 ロジック ( 将来 ) で 使う 便利 述語。 */
export async function isOrgBillingExempt(organizationId: string): Promise<boolean> {
  const state = await getBillingExemption(organizationId);
  return state.isExempt;
}
