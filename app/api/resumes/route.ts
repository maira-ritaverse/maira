import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createResume, ResumeQuotaExceededError } from "@/lib/resumes/queries";
import { saveResumeRequestSchema } from "@/lib/resumes/types";

/**
 * 履歴書 新規作成 API
 *
 * POST /api/resumes
 * - 認証チェック
 * - 拡張: 任意 sourceResumeId (UUID) — 複製元の id を 指定 すると
 *   月次クォータ を 消費 せずに 作成 する (サーバ側で 自分の 履歴書か 検証)。
 * - 戻り値:作成した resume の id
 * - 上限超過時:HTTP 429 + JSON { error: "quota_exceeded", current, limit }
 */
const requestSchema = saveResumeRequestSchema.extend({
  sourceResumeId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { sourceResumeId, ...input } = parsed.data;

  try {
    const id = await createResume(user.id, input, undefined, sourceResumeId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof ResumeQuotaExceededError) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          message: `今月の 履歴書作成 枠 (${error.limit} 件) を 使い切りました。 翌月 1 日に リセット されます。`,
          current: error.current,
          limit: error.limit,
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      {
        error: "Failed to create",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}
