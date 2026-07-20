import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit/audit-log";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import {
  createSoloCheckoutSession,
  getOrgStripeConfig,
  isSoloStripeConfigured,
} from "@/lib/integrations/stripe";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/self-serve/create-solo-account
 *
 * 認証済 ユーザー が Solo / Solo Pro プラン の 個人 organization を セルフサーブ で
 * 作成 する。 招待経由 で なく 個人事業主 / フリーの CA が 直接 サインアップ する
 * 経路。
 *
 * 前提:
 *   ・呼出 ユーザー は Supabase Auth で auth.users 済み (client 側 で supabase.auth.signUp 済)
 *   ・profiles.account_type は 'seeker' (未 昇格) or 'organization_member' だが
 *     organization_members に 行 が 無い 状態
 *
 * 処理 順:
 *   1. 認証 (requireUser)
 *   2. 「既存 メンバー」 チェック: organization_members に active (removed_at=null)
 *      な 行 が あれば 拒否 (二重 契約 防止)
 *   3. 求職者 データ (resumes / career_profiles / applications / conversations)
 *      チェック: 既存 求職者 と の 兼用 は 認めない
 *   4. profiles.account_type を 'organization_member' に upsert
 *   5. organizations 作成 (is_personal=true、 name は パラメータ か デフォルト)
 *   6. organization_members 作成 (role='admin')
 *   7. organization_plans 作成 (tier, cycle, status='trialing', trial_ends_at=+14 日)
 *   8. Stripe が 設定済 なら createSoloCheckoutSession を 呼び URL を 返す
 *      (未設定 なら /agency に fallback、 決済 は 後 で 手動で 設定 可能)
 *   9. 監査ログ
 *
 * 失敗時 の ロール バック: 逆順 で 削除 (Supabase に distributed tx が 無い ため)。
 *
 * セキュリティ:
 *   ・rate limit は middleware / Vercel 側 に 委任 (このハンドラで は 実装 しない)
 *   ・入力 バリデーション で 予期せぬ tier / cycle を 弾く
 *   ・admin 発行 経路 (POST /api/admin/organizations) と 混同 しない よう、
 *     この route は is_personal=true 固定
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  plan: z.enum(["solo", "solo_pro"]),
  cycle: z.enum(["monthly", "yearly"]).default("monthly"),
  /**
   * 個人 org の 表示名。 デフォルト は email の 「@」の 手前 部分 + 「のワークスペース」。
   * 100 文字 まで。
   */
  organizationName: z.string().min(1).max(100).optional(),
});

const TRIAL_DAYS = 14;

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { plan, cycle, organizationName: rawOrgName } = parsed.data;

  const admin = createServiceClient();

  // ── 既存 メンバー チェック
  // active な organization_members 行 が 有れば 「既 に 別 の 組織 の メンバー」
  // な の で 二重 契約 を 防ぐ ため 拒否。
  const { count: activeMemberCount, error: memberCheckErr } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("removed_at", null);
  if (memberCheckErr) {
    return NextResponse.json(
      { error: "lookup_failed", message: memberCheckErr.message },
      { status: 500 },
    );
  }
  if ((activeMemberCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "already_member",
        message:
          "既に 別の 組織 の メンバー です。 Solo プラン は 個人事業主 / フリー の 独立 アカウント 用 な の で、 既存 組織 を 退会 して から お試し ください。",
      },
      { status: 409 },
    );
  }

  // ── 求職者 データ チェック
  // 求職者 として 使って いる アカウント で 個人 CA プラン に 昇格 させる と
  // データ 帰属 (求職者 の 自分 の データ vs CA と して 管理 する データ) が
  // 混ざる の で 拒否。 別 メール で 新規 サインアップ を 促す。
  const [
    { count: resumeCount },
    { count: profileCount },
    { count: appCount },
    { count: convCount },
  ] = await Promise.all([
    admin.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    admin
      .from("career_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    admin.from("applications").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    admin.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  const seekerDataTotal =
    (resumeCount ?? 0) + (profileCount ?? 0) + (appCount ?? 0) + (convCount ?? 0);
  if (seekerDataTotal > 0) {
    return NextResponse.json(
      {
        error: "has_seeker_data",
        message:
          "この アカウント は 求職者 として 既に データ が あります。 別 メール で 新規 サインアップ して Solo プラン を お試し ください。",
      },
      { status: 409 },
    );
  }

  // ── 表示名 の 決定 (未 指定 なら email の @ 手前 部分)
  const emailLocal = (user.email ?? "").split("@")[0]?.trim();
  const organizationName =
    rawOrgName?.trim() || (emailLocal ? `${emailLocal}のワークスペース` : "個人ワークスペース");

  // ── 4. profiles.account_type upsert
  //     (Supabase Auth の on-user-created trigger で 空 行 が 作られて いる 想定、
  //      無くて も upsert なので 問題 なし)
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: user.id, account_type: "organization_member" });
  if (profileErr) {
    return NextResponse.json(
      { error: "profile_upsert_failed", message: profileErr.message },
      { status: 500 },
    );
  }

  // ── 5. organizations 作成
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: organizationName, is_personal: true })
    .select("id")
    .single();
  if (orgErr || !orgRow) {
    return NextResponse.json(
      { error: "org_create_failed", message: orgErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const organizationId = (orgRow as { id: string }).id;

  // ── 6. organization_members (admin)
  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: organizationId, user_id: user.id, role: "admin" });
  if (memberErr) {
    // rollback: organizations 削除
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json(
      { error: "member_create_failed", message: memberErr.message },
      { status: 500 },
    );
  }

  // ── 7. organization_plans (trialing 14 日)
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const { error: planErr } = await admin.from("organization_plans").insert({
    organization_id: organizationId,
    tier: plan,
    cycle,
    status: "trialing",
    trial_started_at: trialStartedAt.toISOString(),
    trial_ends_at: trialEndsAt.toISOString(),
    current_period_start: trialStartedAt.toISOString(),
    current_period_end: trialEndsAt.toISOString(),
  });
  if (planErr) {
    // rollback: members → org の 順 で 削除。 org 削除 で cascade で members も 消えるが、
    // 明示 的 に 2 段階 で 削除 して デバッグ ログ を 出し やすく する。
    await admin
      .from("organization_members")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", user.id);
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json(
      { error: "plan_create_failed", message: planErr.message },
      { status: 500 },
    );
  }

  // ── 8. Stripe Checkout Session (設定済 なら)
  //     env 未設定 の 場合 は トライアル 14 日 の 間 に user が 手動 で
  //     /agency/settings/billing で 課金 を セット アップ する 想定。
  let checkoutUrl: string | null = null;
  const stripeConfig = getOrgStripeConfig();
  if (stripeConfig && isSoloStripeConfigured(stripeConfig)) {
    try {
      const session = await createSoloCheckoutSession(stripeConfig, {
        organizationId,
        tier: plan,
        cycle,
        adminEmail: user.email ?? "",
        idempotencyKey: `solo_signup_${organizationId}`,
      });
      checkoutUrl = session.url ?? null;
    } catch (err) {
      // Stripe 側 の 失敗 は org 作成 は 維持 (「後で 手動で 決済」 の 経路 で 復旧可)。
      // warn ログ のみ、 レスポンス は 200 で 返す。
      console.warn("[self-serve] Stripe checkout creation failed", {
        organizationId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── 9. 監査 ログ (subscription_changed に event_subtype を 添えて 記録。
  //     admin_accessed_user と 同じ 「一般 action + event_subtype で 分類」パターン)
  await recordAuditLog({
    userId: user.id,
    action: "subscription_changed",
    metadata: {
      event_subtype: "self_serve_solo_signup",
      organization_id: organizationId,
      tier: plan,
      cycle,
      trial_ends_at: trialEndsAt.toISOString(),
      stripe_checkout_generated: checkoutUrl !== null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    organizationId,
    trialEndsAt: trialEndsAt.toISOString(),
    // Stripe が 設定 されて いれば Checkout URL、 それ以外 は /agency へ 誘導
    redirectTo: checkoutUrl ?? "/agency?welcome=1",
    checkoutUrl,
  });
}
