import { generateText } from "ai";
import { NextResponse } from "next/server";

import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import {
  buildInterviewPrepPrompt,
  parseInterviewPrepOutput,
} from "@/lib/ai/prompts/interview-prep";
import { recordAnthropic429Event } from "@/lib/ai/rate-limit-monitor";
import { requireOrgMember } from "@/lib/api/auth-guards";
import { getCareerProfile } from "@/lib/career/conversations";
import { getClientRecord } from "@/lib/clients/queries";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { upsertInterviewPrep } from "@/lib/interview-preps/queries";
import { getJobPosting } from "@/lib/jobs/queries";
import { getReferral } from "@/lib/referrals/queries";

/**
 * POST /api/agency/referrals/[id]/interview-prep
 *
 * referral(候補者 × 求人)に対する面接対策を AI 生成して保存する。
 * 推薦文ドラフト(recommendation-letters/draft)と同じフローだが、こちらは
 * 生成結果を interview_preps に暗号化保存する(referral 単位で最新に上書き)。
 *
 * フロー:認証 + 組織メンバー → 月次 AI 上限チェック → referral / client /
 *   career_profile / job を取得 → Claude 生成 → 利用量記録 → 暗号化保存 → 返却。
 */
export const maxDuration = 60;

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: referralId } = await ctx.params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, user, member } = guard;

  // 組織横断 月次上限チェック(admin が /agency/settings/ai-usage で設定)
  const usage = await checkAiUsageLimit(supabase, user.id, "agency_interview_prep");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました(${usage.current} / ${usage.limit})。来月のリセット後、または管理者が設定変更後に再試行してください。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  // referral を取得して自社のものか確認(RLS でも保証されているが二重防御)
  const referral = await getReferral(referralId);
  if (!referral || referral.organizationId !== organization.id) {
    return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  }

  const client = await getClientRecord(referral.clientRecordId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // 候補者がユーザーアカウント未連携(手動登録の名簿のみ)なら career_profile が無い。
  if (!client.linkedUserId) {
    return NextResponse.json(
      {
        error: "Client is not linked to a seeker account",
        code: "not_linked",
        message:
          "この候補者はまだ求職者アカウントと連携していません。連携を完了してから面接対策を生成してください。",
      },
      { status: 400 },
    );
  }

  const profileData = await getCareerProfile(client.linkedUserId);
  if (!profileData) {
    return NextResponse.json(
      {
        error: "No career profile",
        code: "no_career_profile",
        message:
          "この候補者のキャリア棚卸しがまだ完了していません。先に棚卸しを完了してから面接対策を生成してください。",
      },
      { status: 400 },
    );
  }

  const job = await getJobPosting(referral.jobPostingId);
  if (!job) {
    return NextResponse.json({ error: "Job posting not found" }, { status: 404 });
  }

  try {
    const { system, prompt } = buildInterviewPrepPrompt({
      profile: profileData.profile,
      jobPosting: {
        companyName: job.companyName,
        position: job.position,
        employmentType: job.employmentType,
        location: job.location,
        description: job.description,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
        applicationQualifications: job.applicationQualifications,
      },
      advisorNotes: referral.notes,
    });

    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
    });

    // AI 呼出は成功したので利用量を記録(保存の成否に関わらず課金対象のため先に記録)
    await recordAiUsage(supabase, user.id, "agency_interview_prep", {
      referral_id: referral.id,
      job_posting_id: job.id,
      client_record_id: client.id,
    });

    const content = parseInterviewPrepOutput(result.text);

    const saved = await upsertInterviewPrep({
      referralId: referral.id,
      organizationId: organization.id,
      memberId: member.id,
      content,
      model: MODELS.CONVERSATION,
    });
    if ("error" in saved) {
      return NextResponse.json({ error: "save_failed", message: saved.error }, { status: 500 });
    }

    return NextResponse.json({
      prep: { content: saved.content, generatedAt: saved.generatedAt },
    });
  } catch (error) {
    console.error("[interview-prep] generation error:", error);
    const info = categorizeAIError(error);
    if (info.category === "rate_limit") void recordAnthropic429Event();
    return NextResponse.json(
      {
        error: "Failed to generate interview prep",
        message: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}
