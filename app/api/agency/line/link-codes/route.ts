import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";

/**
 * POST /api/agency/line/link-codes
 *
 * client_record 用 の 6 桁 連携コード を 発行 する。
 * 24 時間有効、 既存 の 未消費コード は 自動 失効 (RPC 内)。
 *
 * 入力:{ clientRecordId: uuid }
 * 出力:{ code: "A3F9K2", expiresAt: ISO string }
 */
const bodySchema = z.object({
  clientRecordId: z.string().uuid(),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data, error } = await guard.supabase.rpc("issue_line_link_code", {
    p_client_record_id: parsed.data.clientRecordId,
  });

  if (error) {
    const code = error.message;
    const status = code === "client_not_found" ? 404 : code === "not_org_member" ? 403 : 500;
    return NextResponse.json({ error: code }, { status });
  }

  const generatedCode = data as string;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return NextResponse.json({
    ok: true,
    code: generatedCode,
    expiresAt,
  });
}
