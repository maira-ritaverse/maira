import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import {
  buildRecommendationLetterDraftPrompt,
  splitRecommendationLetterOutput,
} from "@/lib/ai/prompts/recommendation-letter-draft";
import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { getCareerProfile } from "@/lib/career/conversations";
import { getClientRecord } from "@/lib/clients/queries";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { getJobPosting } from "@/lib/jobs/queries";
import { getReferral } from "@/lib/referrals/queries";

/**
 * POST /api/agency/recommendation-letters/draft
 *
 * 入力:{ referralId: string }
 * 出力:{ headline: string, body: string }
 *
 * フロー:
 *   1. 認証 + 組織メンバーチェック
 *   2. referral を取得し自社のものか確認
 *   3. client_records.linked_user_id 経由で career_profile を取得
 *      ・linked_user_id が未連携なら 400 code="not_linked"
 *      ・career_profile が無いなら 400 code="no_career_profile"
 *   4. job_postings を取得
 *   5. Claude Sonnet 4.6 でドラフト生成
 *   6. ai_usage_events に kind="recommendation_letter_draft" で記録
 *   7. 出力から「件名」と「本文」を分離して返す
 *
 * 注意:
 *   ・本ルートは保存しない(編集画面 UI が編集 → PATCH で保存する責務分離)。
 *     これにより「AI 生成 → 編集 → 保存」の流れで途中破棄しても DB を汚さない。
 *   ・テンプレ prefix/suffix は AI に渡さない(レンダリング層で連結)。
 */
const draftRequestSchema = z.object({
  referralId: z.string().uuid(),
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, user } = guard;

  // 組織横断 月次上限チェック(admin が /agency/settings/ai-usage で設定)
  const usage = await checkAiUsageLimit(supabase, user.id, "recommendation_letter_draft");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました(${usage.current} / ${usage.limit})。来月のリセット後、または 管理者が設定変更後に再試行してください。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = draftRequestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // referral を取得して自社のものか確認(RLS でも保証されているが二重防御)
  const referral = await getReferral(parsed.data.referralId);
  if (!referral || referral.organizationId !== organization.id) {
    return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  }

  // クライアントレコードを取得
  const client = await getClientRecord(referral.clientRecordId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // 候補者がユーザーアカウント未連携(エージェントが手動登録した名簿のみ)の場合は
  // career_profile が無いのでドラフト生成不可。UI で「先に紐付け or 棚卸し」を促す。
  if (!client.linkedUserId) {
    return NextResponse.json(
      {
        error: "Client is not linked to a seeker account",
        code: "not_linked",
        message:
          "このクライアントはまだ求職者アカウントと連携していません。連携を完了してからドラフト生成をお試しください。",
      },
      { status: 400 },
    );
  }

  // career_profile を取得
  const profileData = await getCareerProfile(client.linkedUserId);
  if (!profileData) {
    return NextResponse.json(
      {
        error: "No career profile",
        code: "no_career_profile",
        message:
          "この候補者のキャリア棚卸しがまだ完了していません。先に棚卸しを完了してからドラフト生成をお試しください。",
      },
      { status: 400 },
    );
  }

  // 求人情報を取得
  const job = await getJobPosting(referral.jobPostingId);
  if (!job) {
    return NextResponse.json({ error: "Job posting not found" }, { status: 404 });
  }

  try {
    const { system, prompt } = buildRecommendationLetterDraftPrompt({
      profile: profileData.profile,
      jobPosting: {
        companyName: job.companyName,
        position: job.position,
        description: job.description,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
      },
      advisorNotes: referral.notes,
    });

    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
    });

    // ai_usage_events に記録(失敗しても本処理は止めない)
    await recordAiUsage(supabase, user.id, "recommendation_letter_draft", {
      referral_id: referral.id,
      job_posting_id: job.id,
      client_record_id: client.id,
    });

    const { headline, body } = splitRecommendationLetterOutput(result.text);

    return NextResponse.json({ headline, body });
  } catch (error) {
    console.error("[recommendation-letter draft] generation error:", error);
    const info = categorizeAIError(error);
    return NextResponse.json(
      {
        error: "Failed to generate draft",
        message: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}
