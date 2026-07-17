import { redirect } from "next/navigation";

import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

import { AiRecommendationSettingsForm } from "./form";

/**
 * /agency/settings/ai-recommendation
 *
 * admin のみ: AI 求人推薦のプリセットと、求職者本人向け推薦に反映するかのトグルを設定。
 * ・fit_focused(既定): 求職者のフィットだけで判定
 * ・balanced: fit を軸に成約報酬を副次的なタイブレーカーにする
 * ・fee_focused: 成約報酬を強く重視(fit の最低ラインは保つ)
 *
 * 求職者側への反映(apply_to_seeker_view)を有効にすると、
 * 求職者本人のマイページ推薦でも同じ preset で並ぶ(単一連携組織のときのみ)。
 * 求職者に成約報酬の金額は一切見えない(UI にも API にも露出しない)。
 */
export default async function AgencyAiRecommendationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    redirect("/agency");
  }

  const { data } = await supabase
    .from("organization_ai_recommendation_settings")
    .select("preset, apply_to_seeker_view")
    .eq("organization_id", role.organization.id)
    .maybeSingle();

  type Row = { preset: string; apply_to_seeker_view: boolean };
  const row = data as Row | null;
  const preset = (row?.preset ?? "fit_focused") as "fit_focused" | "balanced" | "fee_focused";
  const applyToSeekerView = row?.apply_to_seeker_view ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <SettingsBackLink href="/agency/settings" />
      <div>
        <h1 className="mt-1 text-2xl font-bold">AI 求人推薦の設定</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          AI が求職者に求人をおすすめする際の傾きを 3 択で選べます。成約報酬を考慮に
          入れるかどうかは組織で統一されたルールになります。
        </p>
      </div>

      <AiRecommendationSettingsForm
        initialPreset={preset}
        initialApplyToSeekerView={applyToSeekerView}
      />
    </div>
  );
}
