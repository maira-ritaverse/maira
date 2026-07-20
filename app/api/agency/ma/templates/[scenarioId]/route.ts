/**
 * MA テンプレート取得 / 保存 API
 *
 *   GET /api/agency/ma/templates/[scenarioId]
 *     → シナリオに紐づくテンプレートを復号して返す(編集 UI 用)
 *
 *   PUT /api/agency/ma/templates/[scenarioId]
 *     → 件名・本文を暗号化して上書き保存(admin only)
 *
 * scenarioId はパスパラメータ。配下の ma_templates.scenario_id を参照する。
 * 自組織以外のシナリオは RLS で SELECT 段階から見えないため、404 で返す。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { getTemplateForScenario, upsertTemplate } from "@/lib/ma/queries";
import { upsertTemplateSchema } from "@/lib/ma/types";

/** MA 機能 は Team 系 プラン 限定 (Solo 系 は 402)。 */
function maNotAvailable() {
  return NextResponse.json(
    {
      error: "feature_not_available",
      message: "マーケティングオートメーション機能はTeamプラン以上でご利用いただけます。",
    },
    { status: 402 },
  );
}

type RouteContext = { params: Promise<{ scenarioId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { scenarioId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const plan = await getCurrentOrganizationPlan(supabase);
  if (!getPlanEntitlements(plan?.tier ?? "standard").canUseMaFlows) return maNotAvailable();

  try {
    const template = await getTemplateForScenario(role.organization.id, scenarioId);
    if (!template) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load template", message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { scenarioId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    // 配信文面の編集は admin のみ。advisor は閲覧のみ可。
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const plan = await getCurrentOrganizationPlan(supabase);
  if (!getPlanEntitlements(plan?.tier ?? "standard").canUseMaFlows) return maNotAvailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = upsertTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 念のため、scenarioId が自組織のシナリオかを確認
  // (RLS で upsert は弾かれるが、明示的に 404 を返した方が UI が扱いやすい)
  const existing = await getTemplateForScenario(role.organization.id, scenarioId);
  if (!existing) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  try {
    await upsertTemplate({
      organizationId: role.organization.id,
      scenarioId,
      subject: parsed.data.subject,
      body: parsed.data.body,
      updatedByMemberId: role.member.id,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to save template", message }, { status: 500 });
  }
}
