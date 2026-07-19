import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createClientRequestSchema } from "@/lib/clients/types";
import { logClientCreate } from "@/lib/audit/client-audit-log";

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

  const {
    name,
    email,
    phone,
    status,
    notes,
    entry_site,
    email_distribution_enabled,
    name_kana,
    intake_date,
  } = parsed.data;

  const { data, error } = await supabase
    .from("client_records")
    .insert({
      organization_id: role.organization.id,
      assigned_member_id: role.member.id,
      // 新規 登録者 は 現時点 の 呼出 CA と 同じ。 assigned_member_id は 後で
      // 変更 され うる が created_by_member_id は 履歴 と して 変更 しない。
      created_by_member_id: role.member.id,
      name,
      // email は任意入力。空文字は null に倒す(重複判定 / 招待送信の判定を
      // 「値あり = 非空文字列」で揃えるため)。
      email: email || null,
      phone: phone || null,
      status,
      notes: notes || null,
      link_status: "unlinked",
      // 新規登録時から入力可能な 2 列。
      entry_site: entry_site || null,
      email_distribution_enabled,
      // EMPRO 拡張のうち登録時から推奨の 2 項目。
      // name_kana:検索の前提なので最初から入れたい / intake_date:集計の起点。
      // どちらも空文字は null に倒す(集計時の "" を排除)。
      name_kana: name_kana || null,
      intake_date: intake_date || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create client", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  // ── 新規作成 の 監査ログ (失敗 は 握って warn のみ、 本処理 は 止め ない)
  await logClientCreate({
    organizationId: role.organization.id,
    clientRecordId: data.id,
    actorMemberId: role.member.id,
  });

  return NextResponse.json({ id: data.id, success: true });
}
