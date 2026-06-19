import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { checkAiUsageLimit } from "@/lib/features/ai-usage";

/**
 * GET /api/me/doc-create-quota
 *
 * 求職者 本人の 当月 履歴書 / 職務経歴書 作成枠 を 返す。
 * /app/resumes と /app/cvs の ヘッダー、 ダッシュボード ウィジェット で 利用。
 *
 * 戻り値:
 *   {
 *     resume: { current, limit, remaining },
 *     cv:     { current, limit, remaining }
 *   }
 *
 * 注:limit には ブーストチケット 加算 が 反映済 (lib/features/ai-usage の
 *     checkAiUsageLimit が 内部で 計算する)。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 並列取得
  const [resumeUsage, cvUsage] = await Promise.all([
    checkAiUsageLimit(supabase, user.id, "seeker_resume_create"),
    checkAiUsageLimit(supabase, user.id, "seeker_cv_create"),
  ]);

  return NextResponse.json({
    resume: {
      current: resumeUsage.current,
      limit: resumeUsage.limit,
      remaining: Math.max(0, resumeUsage.limit - resumeUsage.current),
    },
    cv: {
      current: cvUsage.current,
      limit: cvUsage.limit,
      remaining: Math.max(0, cvUsage.limit - cvUsage.current),
    },
    resetsAt: resumeUsage.resetsAt,
  });
}
