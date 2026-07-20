import { redirect } from "next/navigation";

import { isSoloSignupEnabled } from "@/lib/config/signup-mode";
import { SoloSignupForm } from "./solo-signup-form";

/**
 * Solo プラン セルフサーブ サインアップ ページ (Server Component)。
 *
 * URL:
 *   /signup/solo               → デフォルト は Solo プラン (¥5,980) を 選択済 で 表示
 *   /signup/solo?plan=solo_pro → Solo Pro プラン (¥9,800) を 選択済 で 表示
 *   /signup/solo?cycle=yearly  → 年払い を 選択済 で 表示 (Solo yearly = ¥59,800、 10 ヶ月分)
 *
 * ゲート:
 *   isSoloSignupEnabled() が false なら /login?reason=signup_closed に redirect。
 *   env NEXT_PUBLIC_SOLO_SIGNUP_ENABLED="true" で 開放。
 *
 * 招待経由 の 既存 signup フロー (/signup?invitationToken=... 等) と は 独立。
 * こちら は 個人事業主 / フリー の CA が 自分 で サインアップ する 導線 専用。
 */
type SearchParams = Promise<{ plan?: string; cycle?: string }>;

export default async function SoloSignupPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isSoloSignupEnabled()) {
    redirect("/login?reason=signup_closed");
  }

  const { plan: rawPlan, cycle: rawCycle } = await searchParams;
  const plan: "solo" | "solo_pro" = rawPlan === "solo_pro" ? "solo_pro" : "solo";
  const cycle: "monthly" | "yearly" = rawCycle === "yearly" ? "yearly" : "monthly";

  return <SoloSignupForm initialPlan={plan} initialCycle={cycle} />;
}
