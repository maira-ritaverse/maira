import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/api/auth-guards";

/**
 * /api/interview/sessions
 *   GET  - 自分の全セッション一覧
 *   POST - 新規セッション作成
 */

const createSchema = z.object({
  positionContext: z
    .object({
      companyName: z.string().max(100).optional(),
      position: z.string().max(100).optional(),
      requiredSkills: z.string().max(500).optional(),
    })
    .default({}),
});

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const { data } = await supabase
    .from("interview_sessions")
    .select("id, position_context, started_at, completed_at, created_at")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false });
  return NextResponse.json({ sessions: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 空 body も許容するため readJsonBody は使わず手動でパース
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body OK
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("interview_sessions")
    .insert({
      user_id: user.id,
      position_context: parsed.data.positionContext,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json({ id: data.id as string }, { status: 201 });
}
