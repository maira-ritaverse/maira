/**
 * /api/agency/reports/preferences
 *
 * GET : 自分のセクション表示設定を返す(未保存なら空配列を返す)
 * PUT : 自分の設定を upsert
 *
 * ユーザー個人の設定なので admin 制限は付けない。
 * organization_id は auth-guard から取得したものを使う(クライアント指定は無視)。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("report_preferences")
    .select("section_order, hidden_sections")
    .eq("user_id", guard.user.id)
    .eq("organization_id", guard.organization.id)
    .maybeSingle();

  type Row = { section_order: unknown; hidden_sections: unknown };
  const row = data as Row | null;
  return NextResponse.json({
    section_order: asStringArray(row?.section_order),
    hidden_sections: asStringArray(row?.hidden_sections),
  });
}

// UI 側の安全のため 50 セクションを上限にする。 実際は 20 未満のはず。
const putBody = z.object({
  section_order: z.array(z.string().min(1).max(80)).max(50),
  hidden_sections: z.array(z.string().min(1).max(80)).max(50),
});

export async function PUT(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = putBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error } = await guard.supabase.from("report_preferences").upsert(
    {
      user_id: guard.user.id,
      organization_id: guard.organization.id,
      section_order: parsed.data.section_order,
      hidden_sections: parsed.data.hidden_sections,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,organization_id" },
  );
  if (error) {
    console.error("[reports/preferences] upsert error:", error);
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** jsonb は unknown で返ってくるので、文字列配列だけを安全に取り出す */
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
