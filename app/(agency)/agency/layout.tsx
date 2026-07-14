import { redirect } from "next/navigation";

import { AgencySidebar } from "@/components/features/agency/agency-sidebar";
import { NotificationBell } from "@/components/features/notifications/notification-bell";
import { PrivacyPolicyModal } from "@/components/features/privacy-policy-modal";
import { Toaster } from "@/components/features/admin/toaster";
import { UserMenu } from "@/components/features/user-menu";
import { ToastProvider } from "@/lib/admin/toast/store";
import {
  getTrialCountdown,
  isPlanReadOnly,
  shouldShowTrialReminder,
  type PlanReadState,
} from "@/lib/billing/plan-status";
import { getUserRole } from "@/lib/organizations/queries";
import { getPolicyAcceptance, needsToAccept } from "@/lib/privacy/policy";
import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ReadOnlyBanner } from "./read-only-banner";
import { TrialReminderModal } from "./trial-reminder-modal";

/**
 * エージェント企業メンバー向けの共通レイアウト
 *
 * 求職者向け /app とは完全に分離した別ルートグループ。
 * ロールガード:
 *   - 未ログイン → /login
 *   - account_type が organization_member 以外、または
 *     organization_members レコードが無い場合 → /app に戻す
 *     (「企業メンバーのフリで他テナントのデータが見える」事故を防ぐため、
 *      Phase 1 の getUserRole は member 未存在時に seeker 扱いで返す)
 */
export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  // getUserRole + profile + policyAcceptance を 並列化。
  // organizations.archived_at は role.organization.id に 依存 する ため 後段。
  // (旧:getUserRole 直列 → 3 並列 で 2 段 構成 だった)
  const [role, { data: profile }, policyAcceptance] = await Promise.all([
    getUserRole(user.id),
    supabase
      .from("profiles")
      .select("display_name, archived_at, avatar_storage_path")
      .eq("id", user.id)
      .single(),
    getPolicyAcceptance(user.id),
  ]);

  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // 組織アーカイブ + 課金プラン を まとめて 取得 (別クエリを直列にしないため)
  const [{ data: orgRow }, { data: planRow }] = await Promise.all([
    supabase.from("organizations").select("archived_at").eq("id", role.organization.id).single(),
    supabase
      .from("organization_plans")
      .select("status, trial_ends_at, stripe_subscription_id, is_billing_exempt")
      .eq("organization_id", role.organization.id)
      .maybeSingle(),
  ]);

  // 運営者によってアーカイブされたユーザ / 組織はログイン不可。
  if (profile?.archived_at || orgRow?.archived_at) {
    await supabase.auth.signOut();
    redirect("/login?archived=1");
  }
  const requirePolicy = needsToAccept(policyAcceptance);
  const hasPriorPolicy = policyAcceptance.acceptedAt !== null;

  // 課金プランに基づくバナー / モーダル判定
  const plan = (planRow ?? null) as PlanReadState | null;
  const readOnly = isPlanReadOnly(plan);
  const bannerStatus = !plan
    ? null
    : plan.status === "canceled"
      ? "canceled"
      : plan.status === "past_due"
        ? "past_due"
        : plan.status === "incomplete"
          ? "incomplete"
          : plan.status === "trialing" &&
              plan.trial_ends_at &&
              new Date(plan.trial_ends_at) < new Date() &&
              !plan.stripe_subscription_id
            ? "trial_expired"
            : null;

  const trialDays = getTrialCountdown(plan);
  const showReminder = shouldShowTrialReminder(plan) && trialDays !== null && plan?.trial_ends_at;

  // 親 を h-screen overflow-hidden に する こと で:
  //   ・サイドバー は 100vh で 固定 され、 ページ スクロール しても 動か ない
  //   ・main 内 だけ overflow-auto で スクロール する
  //   ・ヘッダー も main column の トップ で 固定 表示 さ れる
  return (
    // ToastProvider を エージェント 全画面 で 有効 化。 useToast() が どの Server / Client
    // Component からも 呼べる 状態 に なる (Client Component 側 で 呼ぶ 前提)。
    // <Toaster /> は 画面 右下 に 積む 表示 コンポーネント。 layout 内 に 1 個 だけ 置く。
    <ToastProvider>
      <div className="bg-background flex h-screen overflow-hidden">
        <AgencySidebar organizationName={role.organization.name} memberRole={role.member.role} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b px-4">
            <NotificationBell />
            <UserMenu
              email={user.email ?? ""}
              displayName={profile?.display_name ?? null}
              settingsHref="/agency/settings"
              avatarUrl={resolveAvatarPublicUrl(
                supabase,
                (profile as { avatar_storage_path: string | null } | null)?.avatar_storage_path ??
                  null,
              )}
            />
          </header>
          {bannerStatus && <ReadOnlyBanner status={bannerStatus} />}
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
        {requirePolicy && <PrivacyPolicyModal hasPrior={hasPriorPolicy} />}
        {showReminder && plan && (
          <TrialReminderModal
            daysRemaining={trialDays!}
            trialEndsAt={plan.trial_ends_at!}
            hasSubscription={Boolean(plan.stripe_subscription_id)}
          />
        )}
        {/* readOnly は 上部 バナー + 各 write API 側 の requireWritableOrgPlan で ガード する。
          この layout では 参照 だけ 残して 直接 の redirect は し ない (「読み 取り 専用 で
          既存 データ は 見られる」 が UX 要件 のため)。 */}
        <span data-plan-read-only={readOnly ? "1" : "0"} className="hidden" aria-hidden />
      </div>
      <Toaster />
    </ToastProvider>
  );
}
