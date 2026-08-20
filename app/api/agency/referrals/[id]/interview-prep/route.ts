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
import type { CareerProfile } from "@/lib/career/profile-schema";
import { getClientRecordWithDecrypted } from "@/lib/clients/queries";
import {
  type ClientRecordWithDecrypted,
  clientEmploymentTypeLabels,
  clientFinalEducationLabels,
} from "@/lib/clients/types";
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

  // 棚卸し(career_profile)は不要。エージェントが CRM に入力したプロフィール
  // (client_records)を主な根拠にする。求職者アカウント連携済みで棚卸しがあれば補強に使う。
  const client = await getClientRecordWithDecrypted(referral.clientRecordId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  let careerProfile: CareerProfile | null = null;
  if (client.linkedUserId) {
    const profileData = await getCareerProfile(client.linkedUserId);
    careerProfile = profileData?.profile ?? null;
  }

  const job = await getJobPosting(referral.jobPostingId);
  if (!job) {
    return NextResponse.json({ error: "Job posting not found" }, { status: 404 });
  }

  try {
    const { system, prompt } = buildInterviewPrepPrompt({
      candidate: buildCandidateInfo(client, careerProfile),
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

/**
 * 面接対策プロンプトに渡す「候補者について分かっている情報」を、CRM の client_records
 * (エージェント入力・復号済み)から組み立てる。空 / 未入力の項目は入れない
 * (プロンプト側で創作させないため)。棚卸し(career_profile)があれば補強として加える。
 *
 * 氏名・連絡先・住所・生年月日など個人特定に直結する情報は面接対策に不要なので渡さない。
 * 内部ステータス管理メモ(status_memo / close_reason_note)も対象外(面接対策の根拠にしない)。
 */
function buildCandidateInfo(
  client: ClientRecordWithDecrypted,
  careerProfile: CareerProfile | null,
): Record<string, unknown> {
  const candidateInfo: Record<string, unknown> = {};
  const addStr = (key: string, value: string | null | undefined) => {
    if (typeof value === "string" && value.trim().length > 0) candidateInfo[key] = value.trim();
  };
  const addNum = (key: string, value: number | null | undefined) => {
    if (typeof value === "number") candidateInfo[key] = value;
  };
  const addArr = (key: string, value: string[] | null | undefined) => {
    if (Array.isArray(value) && value.length > 0) candidateInfo[key] = value;
  };

  // エージェントが CRM に入力したプロフィール(client_records)。
  // enum は生コード(full_time 等)でなく日本語ラベルに変換して渡す(AI の誤読防止)。
  addStr(
    "現在の雇用形態",
    client.currentEmploymentType ? clientEmploymentTypeLabels[client.currentEmploymentType] : null,
  );
  addNum("現年収(万円)", client.currentAnnualIncome);
  addStr(
    "最終学歴",
    client.finalEducation ? clientFinalEducationLabels[client.finalEducation] : null,
  );
  addStr("学歴詳細", client.educationDetail);
  addArr("経験業種", client.experienceIndustries);
  addArr("経験職種", client.experienceOccupations);
  addStr("保有スキル・資格", client.skills);
  addStr("転職理由", client.jobChangeReason);
  addArr("希望業種", client.desiredIndustries);
  addArr("希望職種", client.desiredOccupations);
  addArr("希望勤務地", client.desiredLocations);
  addNum("希望年収(万円)", client.desiredAnnualIncome);
  addStr("希望条件(詳細)", client.desiredConditions);
  addStr("エージェントの推薦コメント", client.recommendationComment);
  addStr("面談所感(エージェントの所感)", client.meetingNotes);
  addStr("備考", client.notes);

  // 棚卸し(求職者本人が実施済みなら補強として加える)
  if (careerProfile) {
    addStr("棚卸し:要約", careerProfile.summary);
    if (Array.isArray(careerProfile.strengths) && careerProfile.strengths.length > 0) {
      candidateInfo["棚卸し:強み"] = careerProfile.strengths;
    }
    if (Array.isArray(careerProfile.values) && careerProfile.values.length > 0) {
      candidateInfo["棚卸し:価値観"] = careerProfile.values;
    }
    // wants は配列ではなくオブジェクト({industries, role_types, company_sizes})。
    // 中身が空でないときだけ、日本語ラベルの構造化オブジェクトとして渡す。
    const wants = careerProfile.wants;
    if (
      wants.industries.length > 0 ||
      wants.role_types.length > 0 ||
      wants.company_sizes.length > 0
    ) {
      candidateInfo["棚卸し:志向"] = {
        希望業界: wants.industries,
        希望職種: wants.role_types,
        希望企業規模: wants.company_sizes,
      };
    }
  }

  return candidateInfo;
}
