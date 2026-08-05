import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";

import { SoloCompleteClient } from "./solo-complete-client";

/**
 * /signup/solo/complete
 *
 * Solo セルフサーブ の 確認後 着地ページ(Server Component)。
 *
 * フロー:
 *   startSoloSignup → 確認メール → /auth/confirm(verifyOtp で 確認 + ログイン)
 *   → next=/signup/solo/complete で ここに 着地。
 *   user_metadata.pending_solo に 保存した 登録意図(plan / cycle / 表示名)を 読み、
 *   client 側で 既存 API /api/self-serve/create-solo-account を 呼んで org + プランを
 *   作成する(手動で /signup/solo に 戻る 必要が ない)。
 *
 * ガード:
 *   ・未ログイン(直接アクセス / リンク失効)→ /login。
 *   ・pending_solo が 無い(既に 完了済み / 通常ユーザー)→ /agency。
 */
type PendingSolo = {
  plan?: string;
  cycle?: string;
  org_name?: string | null;
};

export default async function SoloCompletePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?reason=confirm_required");
  }

  const pending = (user.user_metadata?.pending_solo ?? null) as PendingSolo | null;
  if (!pending || (pending.plan !== "solo" && pending.plan !== "solo_pro")) {
    // 登録意図が 無い = 既に 完了済み or この導線の 対象外 → 通常の 着地先へ。
    redirect("/agency");
  }

  const plan: "solo" | "solo_pro" = pending.plan === "solo_pro" ? "solo_pro" : "solo";
  const cycle: "monthly" | "yearly" = pending.cycle === "yearly" ? "yearly" : "monthly";
  const organizationName = pending.org_name?.trim() || undefined;

  return <SoloCompleteClient plan={plan} cycle={cycle} organizationName={organizationName} />;
}
