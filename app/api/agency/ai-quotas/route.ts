import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { getOrganizationAiQuotas } from "@/lib/agency/ai-usage-queries";

/**
 * AI 利用 月次上限の 取得 / 更新 API
 *
 * GET  /api/agency/ai-quotas
 *   ・自組織の 全 kind の 上限を 取得
 *   ・admin / advisor 両方 閲覧可
 *
 * PUT  /api/agency/ai-quotas
 *   ・admin だけが 更新可
 *   ・body: { quotas: Array<{ kind: string, monthlyLimit: number | null }> }
 *   ・null = 既定値に戻す、0 = 完全停止、正の整数 = 明示上限
 *   ・部分更新 OK(配列に 含まれている kind だけ upsert)
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
        monthlyLimit: z.number().int().min(0).max(100_000).nullable(),
      }),
    )
    .min(1)
    .max(KIND_VALUES.length),
});

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  // admin / advisor 共に閲覧可(RPC 側で 自組織のみに 絞っている)
  try {
    const rows = await getOrganizationAiQuotas();
    return NextResponse.json({ quotas: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "fetch_failed", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, member } = guard;

  // admin だけが 更新可(RPC 側でも 再判定するが、二重防御で API でも 弾く)
  if (member.role !== "admin") {
    return NextResponse.json(
      { error: "admin_required", message: "管理者のみが AI 上限を変更できます。" },
      { status: 403 },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 各 kind を 順番に upsert(競合は ほぼ起きない 用途 + 1 req = N 件の Tx は
  // PG 関数を 増やす ほどの 価値が 無いので 直列で十分)。
  for (const { kind, monthlyLimit } of parsed.data.quotas) {
    const { error } = await supabase.rpc("upsert_organization_ai_quota", {
      p_kind: kind,
      p_monthly_limit: monthlyLimit,
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("admin_required")) {
        return NextResponse.json(
          { error: "admin_required", message: "管理者のみが AI 上限を変更できます。" },
          { status: 403 },
        );
      }
      if (msg.includes("invalid_kind")) {
        return NextResponse.json(
          { error: "invalid_kind", message: `未対応の kind: ${kind}` },
          { status: 400 },
        );
      }
      if (msg.includes("negative_limit")) {
        return NextResponse.json(
          { error: "negative_limit", message: "0 以上の整数で設定してください。" },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: "update_failed", message: msg }, { status: 500 });
    }
  }

  // 反映後の状態を 返す(UI 側で 即時表示更新)
  const rows = await getOrganizationAiQuotas();
  return NextResponse.json({ quotas: rows });
}
