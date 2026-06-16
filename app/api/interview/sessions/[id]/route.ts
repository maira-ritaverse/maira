import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { encryptField } from "@/lib/crypto/field-encryption";
import { saveInterviewMessage } from "@/lib/interview/sessions";

/**
 * /api/interview/sessions/[id]
 *
 *   POST  - 1 メッセージを保存(user / assistant いずれも)。フロントが API stream の onFinish で呼ぶ
 *   PATCH - セッションを完了化(completed_at セット)+ 任意の summary を暗号化保存
 *   DELETE - セッション + メッセージ群を削除(cascade)
 */
type RouteParams = { params: Promise<{ id: string }> };

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(10_000),
});

const patchSchema = z.object({
  summary: z.string().min(1).max(10_000).optional(),
  markCompleted: z.boolean().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 所有者確認
  const { data: sess } = await supabase
    .from("interview_sessions")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sess) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await saveInterviewMessage({
    sessionId: id,
    role: parsed.data.role,
    content: parsed.data.content,
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.markCompleted) update.completed_at = new Date().toISOString();
  if (parsed.data.summary) {
    const enc = await encryptField(parsed.data.summary);
    if (enc) update.encrypted_summary = enc;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("interview_sessions")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("interview_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}
