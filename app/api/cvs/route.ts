import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createCv, CvQuotaExceededError } from "@/lib/cvs/queries";
import { saveCvRequestSchema } from "@/lib/cvs/types";

/**
 * 職務経歴書 新規作成 API
 *
 * POST /api/cvs
 * - 拡張: sourceCvId (UUID) — 複製元 指定 で 月次クォータ 消費なし
 * - 上限超過時:HTTP 429
 */
const requestSchema = saveCvRequestSchema.extend({
  sourceCvId: z.string().uuid().optional(),
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

  const { sourceCvId, ...input } = parsed.data;

  try {
    const id = await createCv(user.id, input, sourceCvId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof CvQuotaExceededError) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          message: `今月の 職務経歴書 作成枠 (${error.limit} 件) を 使い切りました。 翌月 1 日に リセット されます。`,
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
