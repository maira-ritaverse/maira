import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { createApplication } from "@/lib/applications/queries";
import type { ApplicationStatus } from "@/lib/applications/types";
import { listSeekerReferrals } from "@/lib/seeker-referrals/queries";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/me/agent-referrals/[id]/track-as-application
 *
 * エージェント側で進められている referral を、求職者自身の応募管理に「追加」する。
 *
 * 認可:
 *   ・referrals は agency-only RLS のため直接 select 不可
 *   ・listSeekerReferrals(RPC 経由)で「自分が見える referrals」のなかから ID 一致を探す
 *   ・一致しなければ 404(他人の referral を勝手に追加できないように)
 *
 * 動作:
 *   ・applications テーブルに新規行を作成
 *   ・status は referral.status に近い形に変換(planned/recommended → considering、
 *     screening/interview → interview 等)
 *   ・既存の application があるかは判定しない(重複作成は許容、UI 側で表示で気づく)
 */
function mapReferralStatusToApplicationStatus(refStatus: string): ApplicationStatus {
  switch (refStatus) {
    case "planned":
    case "recommended":
      return "considering";
    case "screening":
      return "document_review";
    case "interview":
      return "interview";
    case "offer":
      return "offer";
    case "joined":
      return "offer"; // 入社後の応募管理は範囲外(一旦 offer に倒す)
    case "declined":
      return "rejected";
    default:
      return "considering";
  }
}

export async function POST(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;
  const { id: referralId } = await params;

  // 自分が見える referrals の中から該当を探す
  const referrals = await listSeekerReferrals();
  const target = referrals.find((r) => r.referralId === referralId);
  if (!target) {
    return NextResponse.json(
      { error: "not_found", message: "この推薦は見つかりませんでした" },
      { status: 404 },
    );
  }

  try {
    const applicationId = await createApplication(user.id, {
      details: {
        company: target.jobCompanyName,
        position: target.jobPosition,
        location: target.jobLocation ?? undefined,
        salary_range:
          target.jobSalaryMin != null || target.jobSalaryMax != null
            ? `${target.jobSalaryMin ?? "?"}〜${target.jobSalaryMax ?? "?"} 万円`
            : undefined,
        notes: `${target.organizationName} 経由(${target.status} で進行中)`,
      },
      status: mapReferralStatusToApplicationStatus(target.status),
    });
    return NextResponse.json({ ok: true, applicationId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "create_failed", message: msg }, { status: 500 });
  }
}
