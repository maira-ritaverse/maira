/**
 * 組織 課金 の 席 数 同期 ロジック。
 *
 * 責務:
 *   ・純関数 で 「メンバー 数 → Extra Seat quantity」 を 計算 (副 作用 なし)
 *   ・DB (organization_members) から 実測 の active メンバー 数 を 引く
 *   ・Stripe subscription item の quantity を 更新 (追加 / 削除 / quantity 変更)
 *   ・DB (organization_plans.stripe_subscription_item_id_extra_seat) を 同期
 *
 * 想定 呼び出し 元:
 *   ・招待 受諾 直後 (app/invite/[token]/actions.ts)
 *   ・メンバー 削除 直後 (app/api/agency/members/[id]/route.ts)
 *   ・cron で の 全 組織 リカバリー (app/api/internal/billing/seat-reconcile/route.ts)
 *
 * 失敗 時: 呼び出し 側 で seat_sync_failures テーブル に 積んで cron が リトライ。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addSubscriptionItem,
  getOrgStripeConfig,
  removeSubscriptionItem,
  retrieveSubscription,
  updateSubscriptionSeatQuantity,
  type OrgStripeConfig,
} from "@/lib/integrations/stripe";
import { createServiceClient } from "@/lib/supabase/service";

/** Standard の Base 契約 に 含まれる 席 数 (無料 席、 課金 対象 外)。 */
export const SEAT_BASE_INCLUDED = 3 as const;

export type SeatBreakdown = {
  /** 現在 の active メンバー 数 (base 込み) */
  memberCount: number;
  /** Stripe Extra Seat item に 設定 する quantity */
  extraSeatQuantity: number;
};

/**
 * メンバー 数 から Extra Seat の 課金 数 を 純関数 で 計算。
 *
 * ルール:
 *   ・Base 契約 に 3 席 込み
 *   ・memberCount >= 3 なら extra = memberCount - 3
 *   ・memberCount < 3 なら extra = 0 (Base の 無料 席 内 で 収まる)
 *   ・負 数 / 小数 は 防御 で 切り 上げ
 */
export function computeExtraSeatQuantity(memberCount: number): SeatBreakdown {
  const safeCount = Math.max(0, Math.floor(memberCount));
  return {
    memberCount: safeCount,
    extraSeatQuantity: Math.max(0, safeCount - SEAT_BASE_INCLUDED),
  };
}

/**
 * DB から active な メンバー 数 を 引く。
 * removed_at IS NULL の 行 だけ が active (soft delete 済 は Stripe 課金 対象外)。
 */
export async function countActiveMembers(
  admin: SupabaseClient,
  organizationId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    // soft delete された メンバー は 席数 に 含めない (Stripe 課金 の 分母)
    .is("removed_at", null);
  if (error) throw new Error(`countActiveMembers failed: ${error.message}`);
  return count ?? 0;
}

export type SyncSeatCountResult =
  | { ok: true; skipped: "no_subscription" | "billing_exempt" | "no_change" }
  | { ok: true; updated: { extraSeatQuantity: number; itemId: string | null } }
  | { ok: false; error: string };

/**
 * 組織 の Extra Seat quantity を DB から 再 計算 し、 Stripe に 反映 する。
 *
 * 早期 return 条件:
 *   ・organization_plans 行 が 無い (プラン 未 開始) → skipped: "no_subscription"
 *   ・is_billing_exempt = true (免除 中) → skipped: "billing_exempt"
 *   ・stripe_subscription_id が NULL (Checkout 未 完了) → skipped: "no_subscription"
 *   ・現在 の Stripe quantity と 一致 → skipped: "no_change"
 *
 * 反映 ロジック:
 *   ・quantity > 0 && item_id 有 → updateSubscriptionSeatQuantity で quantity 変更
 *   ・quantity > 0 && item_id 無 → addSubscriptionItem で 新規 line 追加
 *   ・quantity = 0 && item_id 有 → removeSubscriptionItem で 削除
 *   ・quantity = 0 && item_id 無 → no-op
 *
 * proration は 常 に "create_prorations" ( トライアル 中 は Stripe 側 で 自動 判定 )。
 */
export async function syncOrganizationSeatCount(args: {
  organizationId: string;
  reason: "invitation_accepted" | "member_removed" | "cron_reconciliation" | "manual";
}): Promise<SyncSeatCountResult> {
  // 全体 を try/catch で 包んで、 一過性 例外 (Supabase 5xx、 fetch 失敗 等) も
  // { ok: false, error } に 統一 する。 syncSeatCountOrEnqueueFailure で
  // enqueue に 落とせる ように する た め。
  try {
    return await syncOrganizationSeatCountInner(args);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function syncOrganizationSeatCountInner(args: {
  organizationId: string;
  reason: "invitation_accepted" | "member_removed" | "cron_reconciliation" | "manual";
}): Promise<SyncSeatCountResult> {
  const admin = createServiceClient();

  // 1. plan 情報 を 取得
  const { data: plan, error: planErr } = await admin
    .from("organization_plans")
    .select(
      "stripe_subscription_id, stripe_subscription_item_id_extra_seat, cycle, is_billing_exempt, seat_count",
    )
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (planErr) return { ok: false, error: planErr.message };
  if (!plan) return { ok: true, skipped: "no_subscription" };
  if (plan.is_billing_exempt) return { ok: true, skipped: "billing_exempt" };
  if (!plan.stripe_subscription_id) return { ok: true, skipped: "no_subscription" };

  // 2. Stripe config
  const config = getOrgStripeConfig();
  if (!config) return { ok: false, error: "stripe_not_configured" };

  // 3. メンバー 数 → 目標 quantity
  const memberCount = await countActiveMembers(admin, args.organizationId);
  const { extraSeatQuantity } = computeExtraSeatQuantity(memberCount);

  // 4. DB の seat_count と 目標 が 一致 = Stripe も 一致 して いる 前提 で no-op
  //    (Webhook で seat_count が 反映 されて いる 状態 を 信じる)。
  //    ただし cron_reconciliation は 最後 の 砦 な の で、 Stripe 側 の 実 quantity
  //    も 突合 し、 Stripe だけ ズレ て いる ケース (Dashboard 手動 編集 + Webhook
  //    ロスト 等) を 検出 する。 他 の 経路 は 早期 return で 済ませる。
  const currentDbTotalSeats = plan.seat_count ?? SEAT_BASE_INCLUDED;
  const currentDbExtraSeat = Math.max(0, currentDbTotalSeats - SEAT_BASE_INCLUDED);
  if (currentDbExtraSeat === extraSeatQuantity) {
    if (args.reason !== "cron_reconciliation") {
      return { ok: true, skipped: "no_change" };
    }
    // cron: Stripe 側 の 実 quantity を 引いて 突合
    try {
      const stripeSub = await retrieveSubscription(config, plan.stripe_subscription_id);
      const extraSeatItem = stripeSub.items.data.find(
        (i) =>
          i.price.id === config.prices.extraSeatMonthly ||
          i.price.id === config.prices.extraSeatYearly,
      );
      const stripeQty = extraSeatItem?.quantity ?? 0;
      if (stripeQty === extraSeatQuantity) {
        return { ok: true, skipped: "no_change" };
      }
      // Stripe だけ が ズレ て いる → 下 の 反映 ロジック に 進む
    } catch (e) {
      // Stripe API 一過性 失敗 は 「今 回 は skip、 次回 cron で 再挑戦」 が 妥当
      return {
        ok: false,
        error: `retrieveSubscription failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // 5. Stripe API 呼び出し
  const extraSeatItemId = plan.stripe_subscription_item_id_extra_seat;
  const priceId = pickExtraSeatPriceId(config, plan.cycle);

  try {
    let resultItemId: string | null = null;

    if (extraSeatQuantity > 0 && extraSeatItemId) {
      // 5-a. 既存 item の quantity 更新
      const updated = await updateSubscriptionSeatQuantity(config, {
        subscriptionItemId: extraSeatItemId,
        quantity: extraSeatQuantity,
        prorationBehavior: "create_prorations",
      });
      resultItemId = updated.id;
    } else if (extraSeatQuantity > 0 && !extraSeatItemId) {
      // 5-b. subscription に 新規 line item を 追加
      const created = await addSubscriptionItem(config, {
        subscriptionId: plan.stripe_subscription_id,
        priceId,
        quantity: extraSeatQuantity,
        prorationBehavior: "create_prorations",
      });
      resultItemId = created.id;
    } else if (extraSeatQuantity === 0 && extraSeatItemId) {
      // 5-c. quantity 0 なら item を 削除
      await removeSubscriptionItem(config, {
        subscriptionItemId: extraSeatItemId,
        prorationBehavior: "create_prorations",
      });
      resultItemId = null;
    } else {
      // 5-d. quantity 0 で item も 無 → no-op
      return { ok: true, skipped: "no_change" };
    }

    // 6. DB の item_id と seat_count を 更新
    //    Webhook でも 同じ 更新 が 来る が、 last_synced_at + last_stripe_event_id で
    //    idempotency が 効く の で 重複 更新 に よる 事故 は 起きない。
    await admin
      .from("organization_plans")
      .update({
        stripe_subscription_item_id_extra_seat: resultItemId,
        seat_count: memberCount < SEAT_BASE_INCLUDED ? SEAT_BASE_INCLUDED : memberCount,
      })
      .eq("organization_id", args.organizationId);

    return {
      ok: true,
      updated: { extraSeatQuantity, itemId: resultItemId },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** cycle に 応じて Extra Seat の Price ID を 返す。 */
function pickExtraSeatPriceId(config: OrgStripeConfig, cycle: "monthly" | "yearly"): string {
  return cycle === "yearly" ? config.prices.extraSeatYearly : config.prices.extraSeatMonthly;
}

/**
 * syncOrganizationSeatCount を 呼び、 失敗 したら seat_sync_failures に enqueue する。
 * 呼び出し 元 (招待 受諾 / メンバー 削除) は 例外 を 投げず に 「後で cron が 直す」 モデル。
 */
export async function syncSeatCountOrEnqueueFailure(args: {
  organizationId: string;
  reason: "invitation_accepted" | "member_removed" | "manual";
}): Promise<SyncSeatCountResult> {
  const result = await syncOrganizationSeatCount(args);
  if (result.ok) return result;

  // 失敗 は 失敗 キュー に 積む (cron が 拾って リトライ する)
  const admin = createServiceClient();
  const memberCount = await countActiveMembers(admin, args.organizationId).catch(() => 0);
  const { extraSeatQuantity } = computeExtraSeatQuantity(memberCount);
  await admin.from("seat_sync_failures").insert({
    organization_id: args.organizationId,
    target_quantity: extraSeatQuantity,
    error_message: result.error,
    retry_count: 0,
  });
  return result;
}

/**
 * 次回 リトライ 時刻 を 指数 バック オフ で 算出。
 *   0 回 目 の 失敗 → 5 分 後
 *   1 回 目       → 30 分 後
 *   2 回 目       → 6 時間 後
 *   3 回 目 以降  → 24 時間 後 で 打ち止め
 */
export function nextRetryDelayMs(retryCount: number): number {
  if (retryCount <= 0) return 5 * 60 * 1000;
  if (retryCount === 1) return 30 * 60 * 1000;
  if (retryCount === 2) return 6 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}
