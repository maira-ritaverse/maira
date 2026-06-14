/**
 * MA シナリオ一覧 / 更新 API
 *
 *   GET   /api/agency/ma/scenarios
 *     → 自組織の有効化状態を含めたシナリオビュー(プリセット + 有効化)を返す
 *
 *   PATCH /api/agency/ma/scenarios
 *     → 特定プリセットの有効化状態 / 日数上書きを更新する
 *
 * 認可:
 *   - GET   は organization_member であれば誰でも(admin / advisor)
 *   - PATCH は admin のみ(配信制御は管理者権限とする)
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listScenarioViews, upsertScenarioActivation } from "@/lib/ma/queries";
import { updateScenarioActivationSchema } from "@/lib/ma/types";

export async function GET() {
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

  try {
    const views = await listScenarioViews(role.organization.id);
    return NextResponse.json({ scenarios: views });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to list scenarios", message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
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
    // 配信制御は admin のみ。advisor は閲覧のみ可。
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateScenarioActivationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const activation = await upsertScenarioActivation({
      organizationId: role.organization.id,
      presetId: parsed.data.presetId,
      isActive: parsed.data.isActive,
      triggerDaysOverride: parsed.data.triggerDaysOverride,
    });
    return NextResponse.json({ activation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update scenario", message }, { status: 500 });
  }
}
