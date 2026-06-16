import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";

/**
 * POST /api/career-intake/recordings/[id]/share
 *
 * 録音 1 件に対して新しい共有リンクを発行する。
 * - 本人のみ
 * - 録音が "extracted" 状態でなければ作成不可
 * - デフォルト 7 日有効、最大 30 日
 *
 * 戻り値:{ id, token, expiresAt, url }
 */
type RouteParams = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  label: z.string().max(100).optional(),
  // 有効日数(1〜30)
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export async function POST(request: Request, { params }: RouteParams) {
  const { id: recordingId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 状態チェック
  const { data: rec } = await supabase
    .from("career_intake_recordings")
    .select("id, status")
    .eq("id", recordingId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  if ((rec as { status: string }).status !== "extracted") {
    return NextResponse.json(
      { error: "抽出が完了していない録音は共有できません" },
      { status: 409 },
    );
  }

  const bodyResult = await readJsonBody(request);
  // 空ボディは許容(default 適用)。bodyResult.ok=false なら 400 を返さず空オブジェクトで進める
  const parsed = requestSchema.safeParse(bodyResult.ok ? bodyResult.body : {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsed.data.expiresInDays);

  const { data: ins, error } = await supabase
    .from("career_intake_shares")
    .insert({
      recording_id: recordingId,
      user_id: user.id,
      label: parsed.data.label ?? null,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, token, expires_at, label, created_at")
    .single();

  if (error || !ins) {
    return NextResponse.json(
      { error: "Failed to create share", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  const row = ins as {
    id: string;
    token: string;
    expires_at: string;
    label: string | null;
    created_at: string;
  };
  return NextResponse.json({
    id: row.id,
    token: row.token,
    expiresAt: row.expires_at,
    label: row.label,
    url: buildAbsoluteUrl(`/share/intake/${row.token}`),
  });
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: recordingId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const { data } = await supabase
    .from("career_intake_shares")
    .select("id, token, label, expires_at, revoked_at, created_at")
    .eq("recording_id", recordingId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return NextResponse.json({ shares: data ?? [] });
}
