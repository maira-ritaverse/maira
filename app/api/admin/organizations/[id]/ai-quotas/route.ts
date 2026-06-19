import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { createClient } from "@/lib/supabase/server";

/**
 * GET / PUT /api/admin/organizations/[id]/ai-quotas
 *
 * Maira admin が 企業ごとの AI 強制上限を 取得 / 設定 / 解除 する API。
 *
 * GET:
 *   全 kind の 現在 設定 を 返す ({kind: {monthlyLimit, notes, updatedAt} ...})。
 *   未設定 の kind は エントリ なし。
 *
 * PUT:
 *   body: { quotas: Array<{ kind, monthlyLimit, notes? }> }
 *   monthlyLimit = null で 「強制解除」(エージェント設定 に 戻る)。
 *   monthlyLimit = 0 で 「完全停止」。
 *   部分更新 OK (配列に 含めた kind だけ 処理)。
 *
 * 認可:
 *   isMairaAdmin で 二重 ガード (RPC 側 でも 再判定)。
 *
 * 監査:
 *   recordAuditLog で 変更履歴 を 残す。プラン強制 / 緊急介入 の 証跡用。
 */
const KIND_VALUES = [
  "photo_enhance",
  "job_recommendation_seeker",
  "job_recommendation_agency",
  "recommendation_letter_draft",
  "agency_cv_draft",
  "agency_resume_draft",
  "job_extract_from_document",
  "csv_column_mapping",
] as const;

const updateSchema = z.object({
  quotas: z
    .array(
      z.object({
        kind: z.enum(KIND_VALUES),
        // null = 強制解除 (エージェント設定 / 既定値に 戻る)
        monthlyLimit: z.number().int().min(0).max(100_000).nullable(),
        notes: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(KIND_VALUES.length),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }
  const { id: organizationId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("admin_list_platform_ai_quotas", {
    p_org_id: organizationId,
  });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Array<{
    kind: string;
    monthly_limit: number;
    notes: string | null;
    updated_at: string;
  }>;
  return NextResponse.json({
    quotas: rows.map((r) => ({
      kind: r.kind,
      monthlyLimit: r.monthly_limit,
      notes: r.notes,
      updatedAt: r.updated_at,
    })),
  });
}

export async function PUT(req: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }
  const { id: organizationId } = await params;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  for (const { kind, monthlyLimit, notes } of parsed.data.quotas) {
    if (monthlyLimit === null) {
      // 強制解除 (エージェント設定 / 既定値 に 戻る)
      const { error } = await supabase.rpc("admin_delete_platform_ai_quota", {
        p_org_id: organizationId,
        p_kind: kind,
      });
      if (error) {
        return NextResponse.json(
          { error: "delete_failed", message: error.message, kind },
          { status: 500 },
        );
      }
    } else {
      const { error } = await supabase.rpc("admin_upsert_platform_ai_quota", {
        p_org_id: organizationId,
        p_kind: kind,
        p_monthly_limit: monthlyLimit,
        p_notes: notes ?? null,
      });
      if (error) {
        return NextResponse.json(
          { error: "upsert_failed", message: error.message, kind },
          { status: 500 },
        );
      }
    }
  }

  // 監査ログ:プラン強制 / 緊急介入の 証跡
  await recordAuditLog({
    userId: guard.user.id,
    action: "platform_ai_quota_changed",
    metadata: { organizationId, quotas: parsed.data.quotas },
  }).catch((e) => console.warn("[admin ai-quotas] audit log failed", e));

  // 反映後の 状態 を 返す
  const { data } = await supabase.rpc("admin_list_platform_ai_quotas", {
    p_org_id: organizationId,
  });
  const rows = (data ?? []) as Array<{
    kind: string;
    monthly_limit: number;
    notes: string | null;
    updated_at: string;
  }>;
  return NextResponse.json({
    quotas: rows.map((r) => ({
      kind: r.kind,
      monthlyLimit: r.monthly_limit,
      notes: r.notes,
      updatedAt: r.updated_at,
    })),
  });
}
