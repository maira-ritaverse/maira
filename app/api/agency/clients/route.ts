import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createClientRequestSchema } from "@/lib/clients/types";

/**
 * POST /api/agency/clients
 *
 * 新規クライアントを登録する。
 * - 認証 + organization_member ガード
 * - 登録者がデフォルト担当アドバイザー(assigned_member_id = 自分の member.id)
 * - link_status は 'unlinked' 固定スタート(求職者がメール一致で登録した時点で
 *   別途 'linked' に遷移するロジックを後続Phaseで実装する)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createClientRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { name, email, phone, status, notes, entry_site, email_distribution_enabled } = parsed.data;

  const { data, error } = await supabase
    .from("client_records")
    .insert({
      organization_id: role.organization.id,
      assigned_member_id: role.member.id,
      name,
      email,
      phone: phone || null,
      status,
      notes: notes || null,
      link_status: "unlinked",
      // 新規登録時から入力可能な 2 列。
      entry_site: entry_site || null,
      email_distribution_enabled,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create client", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, success: true });
}
