/**
 * /api/agency/ai-recommendation-settings
 *
 * GET : 自組織 の AI 推薦 プリセット を 返す (未 設定 なら 既定 値)
 * PUT : プリセット + apply_to_seeker_view を upsert (admin のみ)
 *
 * 設計 メモ:
 *   ・organization_id は auth-guard から 取得 した 値 のみ 使う (クライアント 指定 は 無視)
 *   ・preset は fit_focused / balanced / fee_focused の 3 値 のみ 許容
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("organization_ai_recommendation_settings")
    .select("preset, apply_to_seeker_view, updated_at")
    .eq("organization_id", guard.organization.id)
    .maybeSingle();

  type Row = {
    preset: string;
    apply_to_seeker_view: boolean;
    updated_at: string;
  };
  const row = data as Row | null;
  return NextResponse.json({
    preset: row?.preset ?? "fit_focused",
    apply_to_seeker_view: row?.apply_to_seeker_view ?? false,
    updated_at: row?.updated_at ?? null,
  });
}

const putBody = z.object({
  preset: z.enum(["fit_focused", "balanced", "fee_focused"]),
  apply_to_seeker_view: z.boolean(),
});

export async function PUT(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = putBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error } = await guard.supabase.from("organization_ai_recommendation_settings").upsert(
    {
      organization_id: guard.organization.id,
      preset: parsed.data.preset,
      apply_to_seeker_view: parsed.data.apply_to_seeker_view,
      updated_by_user_id: guard.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    console.error("[ai-recommendation-settings] upsert error:", error);
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
