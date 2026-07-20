import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/clients?organizationId=<uuid>&q=<name>&status=<s>
 *
 * 運営者用: 各 CA 企業 の 求職者 (client_records) 一覧。
 *
 * 「/admin/seekers」 は 求職者 本人 (自ら 登録 した seeker アカウント) の 一覧、
 * こちら は 「CA が 自社 CRM に 登録 した 求職者」 の 一覧。 本人 アカウント と
 * 紐づいて いる (link_status='linked') 場合 も あれば、 CA だけ が 持って いる
 * (unlinked) 場合 も ある。
 *
 * 認可: isMairaAdmin ガード。 CA 側 の RLS を バイパス する ため service_role で
 * 全社 横断 で 引く。
 *
 * MVP 規模: 全社 500 件 まで を 一括 取得 (ページ ング なし)。 org / status /
 * name の フィルタ で 絞れる ように しておけば 実用 上 十分。 数千 を 超えたら
 * カーソル ページ ング を 追加 する。
 *
 * 返さ ない もの:
 *   ・暗号化 フィールド (推薦文 / 面談メモ 等) は 一覧 で は 出さ ない。
 *     詳細 ページ で トグル 展開 + audit ログ 記録 の 経路 で 見せる (Phase 2)。
 */

type ClientRow = {
  id: string;
  organization_id: string;
  assigned_member_id: string | null;
  created_by_member_id: string | null;
  name: string;
  name_kana: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  link_status: string;
  entry_site: string | null;
  gender: string | null;
  prefecture: string | null;
  current_employment_type: string | null;
  current_annual_income: number | null;
  crm_tags: string[] | null;
  intake_date: string | null;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  id: string;
  user_id: string;
};

type OrgRow = {
  id: string;
  name: string;
  is_personal: boolean | null;
};

const LIST_LIMIT = 500;

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";

  const admin = createServiceClient();

  // ── 1. client_records を フィルタ 付き で 一括 取得
  let query = admin
    .from("client_records")
    .select(
      [
        "id",
        "organization_id",
        "assigned_member_id",
        "created_by_member_id",
        "name",
        "name_kana",
        "email",
        "phone",
        "status",
        "link_status",
        "entry_site",
        "gender",
        "prefecture",
        "current_employment_type",
        "current_annual_income",
        "crm_tags",
        "intake_date",
        "created_at",
        "updated_at",
      ].join(", "),
    )
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (organizationId) query = query.eq("organization_id", organizationId);
  if (status) query = query.eq("status", status);

  const { data: clientsData, error: clientsErr } = await query;
  if (clientsErr) {
    return NextResponse.json(
      { error: "list_failed", message: clientsErr.message },
      { status: 500 },
    );
  }
  let clients = (clientsData ?? []) as unknown as ClientRow[];

  // name / kana / email の いずれか に q が 含まれる もの に 絞る
  // (Supabase の or() は 使い にくい の で JS 側 で 絞る、 MVP 規模 で 十分)
  if (q) {
    clients = clients.filter((c) => {
      const hay = `${c.name} ${c.name_kana ?? ""} ${c.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // ── 2. 組織 名 を bulk fetch (client の organization_id を distinct 化)
  const orgIds = Array.from(new Set(clients.map((c) => c.organization_id)));
  const { data: orgsData } = await admin
    .from("organizations")
    .select("id, name, is_personal")
    .in("id", orgIds.length > 0 ? orgIds : ["00000000-0000-0000-0000-000000000000"]);
  const orgMap = new Map<string, OrgRow>(((orgsData ?? []) as OrgRow[]).map((o) => [o.id, o]));

  // ── 3. 担当 CA / 起票者 の 名前 を bulk 解決
  //     organization_members から member_id → user_id、 その後 auth.users から email。
  const memberIds = Array.from(
    new Set(clients.flatMap((c) => [c.assigned_member_id, c.created_by_member_id].filter(Boolean))),
  ) as string[];

  const memberToUserId = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: memberRows } = await admin
      .from("organization_members")
      .select("id, user_id")
      .in("id", memberIds);
    for (const m of (memberRows ?? []) as MemberRow[]) {
      memberToUserId.set(m.id, m.user_id);
    }
  }

  // auth.users は listUsers で 一括 (perPage 200)。 MVP 想定 の 総 ユーザー 数。
  const emailByUserId = new Map<string, string>();
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of authList?.users ?? []) {
    if (u.email) emailByUserId.set(u.id, u.email);
  }

  const emailByMemberId = new Map<string, string>();
  for (const [mid, uid] of memberToUserId.entries()) {
    const em = emailByUserId.get(uid);
    if (em) emailByMemberId.set(mid, em);
  }

  const rows = clients.map((c) => {
    const org = orgMap.get(c.organization_id);
    return {
      id: c.id,
      organizationId: c.organization_id,
      organizationName: org?.name ?? "(不明)",
      organizationIsPersonal: Boolean(org?.is_personal),
      name: c.name,
      nameKana: c.name_kana,
      email: c.email,
      phone: c.phone,
      status: c.status,
      linkStatus: c.link_status,
      entrySite: c.entry_site,
      gender: c.gender,
      prefecture: c.prefecture,
      currentEmploymentType: c.current_employment_type,
      currentAnnualIncome: c.current_annual_income,
      crmTags: c.crm_tags ?? [],
      intakeDate: c.intake_date,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      assignedMemberEmail: c.assigned_member_id
        ? (emailByMemberId.get(c.assigned_member_id) ?? null)
        : null,
      createdByEmail: c.created_by_member_id
        ? (emailByMemberId.get(c.created_by_member_id) ?? null)
        : null,
    };
  });

  return NextResponse.json({
    clients: rows,
    total: rows.length,
    limit: LIST_LIMIT,
    truncated: (clientsData ?? []).length >= LIST_LIMIT,
  });
}
