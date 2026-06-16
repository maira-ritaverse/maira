import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import { buildJobTailoredPrPrompt, jobTailoredPrSchema } from "@/lib/ai/prompts/job-tailored-pr";
import { getApplication } from "@/lib/applications/queries";
import { getApplicationPrCustomization } from "@/lib/applications/pr-customizations";
import { getCareerProfile } from "@/lib/career/conversations";
import { listCvs } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";

/**
 * POST /api/applications/[id]/pr-customization/generate
 *
 * 応募 1 件に対して、その求人に最適化した
 *   - resume_self_pr  履歴書用 自己PR
 *   - cv_self_pr      職務経歴書用 自己PR
 *   - motivation_note 志望動機
 * を AI で 1 回の generateObject で生成して返す。
 *
 * フロー:
 *  1. 認証(本人のみ)+ 応募の所有者チェック
 *  2. キャリア棚卸し結果を取得(無ければ 400 + code=no_career_profile)
 *  3. 応募の details(企業名 / 職種 / notes など)を「求人情報」として渡す
 *  4. 履歴書(最新の motivation_note) / 職務経歴書(最新の body.self_pr)
 *     と既存カスタマイズの self_pr をベース文書として渡す(ある場合)
 *  5. generateObject で 3 つの文章を構造化生成して返す
 *
 * 注意:
 *  - 生成結果は DB に保存しない(UI 側で確認 → PUT /pr-customization で保存)
 *  - 棚卸し結果はサーバ側で復号、AI へは平文で送信(設計方針通り)
 *  - 結果はブラウザに平文で返るが、保存時は既存ルート経由で再暗号化される
 */

const generateRequestSchema = z.object({
  /** UI で追加で貼り付けた JD 全文(任意。あれば AI が最優先のソースとして扱う) */
  jdExtra: z.string().max(20000).optional().nullable(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { id } = await params;

  // 応募の所有者チェック(RLS と二重)
  const { data: appRow } = await supabase
    .from("applications")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!appRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if ((appRow as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // リクエストボディ(任意項目)
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = generateRequestSchema.safeParse(json.body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  // 棚卸し結果(必須)
  const profileData = await getCareerProfile(user.id);
  if (!profileData) {
    return NextResponse.json(
      {
        error: "No career profile",
        code: "no_career_profile",
        message: "先にキャリア棚卸しを完了してください。棚卸し結果を元に求人特化版を生成します。",
      },
      { status: 400 },
    );
  }

  // 応募の詳細(企業名 / 職種 / notes など)を求人情報として読む
  const application = await getApplication(id, user.id);
  if (!application) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ベース文書:
  //   - resume_self_pr: 既存カスタマイズの self_pr を使う(履歴書本体には自己PR欄が無いため)
  //   - cv_self_pr    : 最新の職務経歴書の body.self_pr
  //   - motivation    : 既存カスタマイズの motivation_note があればそれ、無ければ最新履歴書の motivationNote
  const [cvs, resumes, existingCustom] = await Promise.all([
    listCvs(user.id),
    listResumes(user.id),
    getApplicationPrCustomization(id),
  ]);
  const latestCv = cvs[0] ?? null;
  const latestResume = resumes[0] ?? null;

  const baseResumeSelfPr = existingCustom?.overrides.self_pr ?? null;
  const baseCvSelfPr = existingCustom?.overrides.cv_self_pr ?? latestCv?.body.self_pr ?? null;
  const baseMotivation =
    existingCustom?.overrides.motivation_note ?? latestResume?.motivationNote ?? null;

  const { system, prompt } = buildJobTailoredPrPrompt({
    profile: profileData.profile,
    job: {
      company: application.details.company,
      position: application.details.position,
      jobUrl: application.details.job_url ?? null,
      notes: application.details.notes ?? null,
      salaryRange: application.details.salary_range ?? null,
      location: application.details.location ?? null,
      jdExtra: parsed.data.jdExtra ?? null,
    },
    base: {
      baseResumeSelfPr: emptyToNull(baseResumeSelfPr),
      baseCvSelfPr: emptyToNull(baseCvSelfPr),
      baseMotivation: emptyToNull(baseMotivation),
    },
  });

  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: jobTailoredPrSchema,
      system,
      prompt,
    });

    return NextResponse.json({
      ok: true,
      generated: result.object,
    });
  } catch (err) {
    const info = categorizeAIError(err);
    return NextResponse.json(
      {
        error: "ai_generation_failed",
        category: info.category,
        message: info.userMessage,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}

// 空文字を null に正規化(プロンプト側で「空文字あり」と「未指定」を区別しないため)
function emptyToNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// generateObject は数十秒かかり得るのでタイムアウトを延長(他の AI ルートと同じ 60s)
export const maxDuration = 60;
