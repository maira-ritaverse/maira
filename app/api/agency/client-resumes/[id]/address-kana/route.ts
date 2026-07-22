import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { getAgencyClientResume } from "@/lib/agency-client-documents/queries";
import { generateAddressKana } from "@/lib/ai/generate-address-kana";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";

/**
 * POST /api/agency/client-resumes/[id]/address-kana
 *
 * 現在入力中の住所(漢字)から現住所フリガナ(全角カタカナ)を AI 生成して返す。
 * DB には保存しない(クライアント側でフォーム state に載せ、通常の保存に含める)。
 *
 * なぜ必要か:
 *   from-profile 作成時の自動生成は「作成の瞬間・かつ住所が既にある」場合の一度きり。
 *   手入力・住所の編集・古い履歴書ではフリガナ欄が空のままになるため、いつでも
 *   現在の住所から生成できるオンデマンド経路を用意する(氏名カナと違い読みが自明でない)。
 *
 * 入力: { address: string }
 * 出力: { kana: string }
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({ address: z.string().min(1).max(300) });

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, supabase, user } = guard;
  const { id: resumeId } = await params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 認可:対象履歴書が呼び出し組織のものであることを確認(RLS と二重防御)
  const resume = await getAgencyClientResume(resumeId, organization.id);
  if (!resume) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // from-profile 側の自動生成と同じ Vision 系 kind で計上し、利用状況の集計を揃える。
  const usage = await checkAiUsageLimit(supabase, user.id, "agency_client_document_extract");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました(${usage.current} / ${usage.limit})。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  const kana = await generateAddressKana(parsed.data.address);
  if (!kana) {
    return NextResponse.json(
      {
        error: "generation_failed",
        message: "フリガナを生成できませんでした。住所を確認して、もう一度お試しください。",
      },
      { status: 502 },
    );
  }

  // 成功時のみ記録(失敗しても本処理は止めない方針は他の AI 経路と同じ)
  await recordAiUsage(supabase, user.id, "agency_client_document_extract", {
    kind: "address_kana_gen",
    resume_id: resumeId,
  });

  return NextResponse.json({ kana });
}
