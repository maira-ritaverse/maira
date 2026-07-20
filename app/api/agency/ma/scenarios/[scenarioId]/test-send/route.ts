/**
 * テスト送信 API
 *
 *   POST /api/agency/ma/scenarios/[scenarioId]/test-send
 *
 * admin only:
 *   - 認可は API ルート側で行い、test-send.ts は組織 ID と scenario ID を信頼する
 *   - 同意撤回チェックは行わない(テスト用)
 *   - 重複送信防止チェックも行わない(テスト用)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { sendTestEmail } from "@/lib/ma/test-send";

type RouteContext = { params: Promise<{ scenarioId: string }> };

const requestSchema = z.object({
  recipientEmail: z.string().email("有効なメールアドレスを入力してください"),
});

export async function POST(request: Request, { params }: RouteContext) {
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // MA 機能 は Team 系 プラン 限定 (Solo 系 は 402)。
  const plan = await getCurrentOrganizationPlan(supabase);
  if (!getPlanEntitlements(plan?.tier ?? "standard").canUseMaFlows) {
    return NextResponse.json(
      {
        error: "feature_not_available",
        message: "マーケティングオートメーション機能はTeamプラン以上でご利用いただけます。",
      },
      { status: 402 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const result = await sendTestEmail({
      organizationId: role.organization.id,
      scenarioId,
      recipientEmail: parsed.data.recipientEmail,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to send test email", message }, { status: 500 });
  }
}
