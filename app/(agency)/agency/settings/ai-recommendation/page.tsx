import { redirect } from "next/navigation";

import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

import { AiRecommendationSettingsForm } from "./form";

/**
 * /agency/settings/ai-recommendation
 *
 * admin のみ:AI 求人推薦 の プリセット と、 求職者本人 向け 推薦 に 反映 するか の トグル を 設定。
 * ・fit_focused (既定): 求職者 の フィット だけ で 判定
 * ・balanced:          fit を 軸 に 成約報酬 を 副次的 な タイブレーカー に する
 * ・fee_focused:       成約報酬 を 強く 重視 (fit の 最低 ライン は 保つ)
 *
 * 求職者 側 への 反映 (apply_to_seeker_view) を 有効 に する と、
 * 求職者本人 の マイページ 推薦 でも 同じ preset で 並ぶ (単一 連携 組織 のときのみ)。
 * 求職者 に 成約報酬 の 金額 は 一切 見えない (UI にも API にも 露出 しない)。
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
          AI が 求職者に 求人を おすすめする 際の 傾きを 3 択で 選べます。 成約報酬を 考慮に
          入れるか どうか は 組織で 統一 された ルールに なります。
        </p>
      </div>

      <AiRecommendationSettingsForm
        initialPreset={preset}
        initialApplyToSeekerView={applyToSeekerView}
      />
    </div>
  );
}
