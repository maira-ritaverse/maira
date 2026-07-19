import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/notes/[lineUserId]
 * 指定 友達 の 全 ノート を 返す (新しい順、 復号済)。
 *
 * POST /api/agency/line/notes/[lineUserId]
 * 新規 ノート 作成。 admin / advisor とも 作成可。
 */
type RouteContext = { params: Promise<{ lineUserId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const { data, error } = await guard.supabase
    .from("line_conversation_notes")
    .select("id, encrypted_content, created_by_user_id, created_at, updated_at")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    encrypted_content: string;
    created_by_user_id: string | null;
    created_at: string;
    updated_at: string;
  };
  const rows = (data ?? []) as Row[];

  // 作成者 名前 を 一括 引き
  const userIds = Array.from(
    new Set(rows.map((r) => r.created_by_user_id).filter((v): v is string => v !== null)),
  );
  const userNameMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: members } = await guard.supabase
      .from("organization_members")
      .select("user_id, role")
      .in("user_id", userIds)
      // soft delete された メンバー は ロール 表示 の 対象 外
      .is("removed_at", null);
    for (const m of (members ?? []) as Array<{ user_id: string; role: string }>) {
      userNameMap.set(m.user_id, m.role);
    }
  }

  // 復号 並列
  const notes = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      content: (await decryptField(r.encrypted_content)) ?? "",
      createdByUserId: r.created_by_user_id,
      createdByLabel: r.created_by_user_id
        ? `(${userNameMap.get(r.created_by_user_id) ?? "メンバー"})`
        : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  );

  return NextResponse.json({ notes });
}

const postBody = z.object({
  content: z.string().min(1).max(10_000),
});

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const encrypted = await encryptField(parsed.data.content);
  if (!encrypted) {
    return NextResponse.json({ error: "encrypt_failed" }, { status: 500 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("line_conversation_notes")
    .insert({
      organization_id: guard.organization.id,
      line_user_id: lineUserId,
      encrypted_content: encrypted,
      created_by_user_id: guard.user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: "insert_failed", message: error?.message ?? "unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
