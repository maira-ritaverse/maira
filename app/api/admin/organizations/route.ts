import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/organizations
 *
 * 運営者用:エージェント企業(organizations)の一覧を返す。
 *
 * 含める情報:
 *   - id / name / created_at
 *   - memberCount   : 所属メンバー数
 *   - adminCount    : admin ロールの数
 *   - lastMemberAt  : 最後にメンバーが追加された日(健全性の目安)
 *
 * 大量データは想定しない MVP 規模なので全件取得 + メモリ集計。
 */
type OrgRow = {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
  archived_reason: string | null;
};
type MemberRow = {
  organization_id: string;
  role: "admin" | "advisor";
  created_at: string;
};
type ClientRow = {
  organization_id: string;
  link_status: string;
};

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  // ?archived=true で退会済タブ、それ以外は現役
  const showArchived = url.searchParams.get("archived") === "true";

  const admin = createServiceClient();

  const baseQuery = admin
    .from("organizations")
    .select("id, name, created_at, archived_at, archived_reason");
  const { data: orgsData, error: orgsErr } = await (showArchived
    ? baseQuery.not("archived_at", "is", null).order("archived_at", { ascending: false })
    : baseQuery.is("archived_at", null).order("created_at", { ascending: false }));
  if (orgsErr) {
    return NextResponse.json({ error: "list_failed", message: orgsErr.message }, { status: 500 });
  }
  const orgs = (orgsData ?? []) as OrgRow[];

  const { data: membersData } = await admin
    .from("organization_members")
    .select("organization_id, role, created_at");
  const members = (membersData ?? []) as MemberRow[];

  // クライアント(求職者)集計のため client_records も取得
  const { data: clientsData } = await admin
    .from("client_records")
    .select("organization_id, link_status");
  const clients = (clientsData ?? []) as ClientRow[];

  // 集計:メンバー = admin / advisor、クライアント = 総数 / linked 数
  const stats = new Map<
    string,
    {
      memberCount: number;
      adminCount: number;
      advisorCount: number;
      clientCount: number;
      linkedClientCount: number;
      lastMemberAt: string | null;
    }
  >();
  const seed = () => ({
    memberCount: 0,
    adminCount: 0,
    advisorCount: 0,
    clientCount: 0,
    linkedClientCount: 0,
    lastMemberAt: null as string | null,
  });
  for (const m of members) {
    const s = stats.get(m.organization_id) ?? seed();
    s.memberCount += 1;
    if (m.role === "admin") s.adminCount += 1;
    if (m.role === "advisor") s.advisorCount += 1;
    if (!s.lastMemberAt || s.lastMemberAt < m.created_at) {
      s.lastMemberAt = m.created_at;
    }
    stats.set(m.organization_id, s);
  }
  for (const c of clients) {
    const s = stats.get(c.organization_id) ?? seed();
    s.clientCount += 1;
    if (c.link_status === "linked") s.linkedClientCount += 1;
    stats.set(c.organization_id, s);
  }

  // 状態判定はサーバ側で(クライアント側で Date.now() を呼ぶと
  // React コンポーネントの purity ルールに引っかかる)
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const organizations = orgs.map((o) => {
    const s = stats.get(o.id) ?? seed();
    const noAdmin = s.adminCount === 0;
    const dormant =
      !noAdmin &&
      (s.lastMemberAt === null || now - new Date(s.lastMemberAt).getTime() > ninetyDaysMs);
    const status = noAdmin ? "no_admin" : dormant ? "dormant" : "active";
    return {
      id: o.id,
      name: o.name,
      createdAt: o.created_at,
      archivedAt: o.archived_at,
      archivedReason: o.archived_reason,
      memberCount: s.memberCount,
      adminCount: s.adminCount,
      advisorCount: s.advisorCount,
      clientCount: s.clientCount,
      linkedClientCount: s.linkedClientCount,
      lastMemberAt: s.lastMemberAt,
      status,
    };
  });

  return NextResponse.json({ organizations, total: organizations.length });
}

// =====================================================================
// POST /api/admin/organizations
//
// BtoBtoC モデルの新規エージェント企業 + 管理者 1 名を発行する。
//
// フロー:
//   1. 認証 + isMairaAdmin ガード
//   2. 入力(会社名 + メアド)の検証
//   3. 同メアドが auth.users に既存していないか事前チェック
//      → 既存なら 409(誤って組織を二重に作るのを防ぐ)
//   4. organizations INSERT
//   5. auth.admin.inviteUserByEmail():auth.users を作成 + 招待メールを送信
//      ・ユーザはメール内リンクから自分でパスワードを設定 → 初回ログイン完了
//      ・リンクが期限切れの場合は通常のパスワードリセットで再発行できる
//        (Supabase 標準の挙動。アプリ側の追加実装は不要)
//   6. profiles に account_type='organization_member' で INSERT
//   7. organization_members に role='admin' で INSERT
//   8. 失敗時は逆順で巻き戻し(service_role なのでアプリ側でロールバック相当を実装)
//   9. audit_log を記録
//
// 注意:
//   - メール送信は Supabase 側のテンプレを使う(Resend 経由ではなく Auth の Email)
//   - Supabase ダッシュボード > Auth > Email Templates の Invite テンプレを
//     日本語化するのは別作業(運用 TODO)
// =====================================================================

const createOrgSchema = z.object({
  companyName: z.string().min(1).max(200),
  adminEmail: z.string().email().max(254),
  // 受信箱の「この企業を発行する」ボタンから来た場合、起点となった
  // contact_messages.id を渡してもらう。audit_log でリード由来の発行を追跡。
  fromContactId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user: actor } = guard;

  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = createOrgSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { companyName, adminEmail, fromContactId } = parsed.data;

  const admin = createServiceClient();

  // 3. 既存メアドチェック(listUsers でメアド検索:200 件まで全件取って絞り込み)
  try {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      return NextResponse.json(
        { error: "lookup_failed", message: listErr.message },
        { status: 500 },
      );
    }
    const exists = list.users.some(
      (u) => (u.email ?? "").toLowerCase() === adminEmail.toLowerCase(),
    );
    if (exists) {
      return NextResponse.json({ error: "email_already_exists" }, { status: 409 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "lookup_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  // 4. organizations INSERT
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: companyName })
    .select("id")
    .single();
  if (orgErr || !orgRow) {
    return NextResponse.json(
      { error: "org_insert_failed", message: orgErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const organizationId = (orgRow as { id: string }).id;

  // 5. auth invite。redirectTo はパスワード設定完了後のアプリ遷移先。
  //    NEXT_PUBLIC_SITE_URL を基準にする。
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  const redirectTo = siteUrl ? `${siteUrl}/agency` : undefined;
  let invitedUserId: string | null = null;
  try {
    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      adminEmail,
      {
        data: {
          invited_for_organization_id: organizationId,
          invited_company_name: companyName,
        },
        redirectTo,
      },
    );
    if (inviteErr || !inviteData?.user) {
      // 巻き戻し:organization を消す
      await admin.from("organizations").delete().eq("id", organizationId);
      return NextResponse.json(
        { error: "invite_failed", message: inviteErr?.message ?? "unknown" },
        { status: 500 },
      );
    }
    invitedUserId = inviteData.user.id;
  } catch (err) {
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json(
      { error: "invite_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  // 6. profiles を作る or 上書き(trigger で既に作られている可能性あり)
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: invitedUserId, account_type: "organization_member" });
  if (profileErr) {
    // 巻き戻し:user + org を消す
    if (invitedUserId) await admin.auth.admin.deleteUser(invitedUserId);
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json(
      { error: "profile_insert_failed", message: profileErr.message },
      { status: 500 },
    );
  }

  // 7. organization_members (admin として)
  const { error: memberErr } = await admin.from("organization_members").insert({
    organization_id: organizationId,
    user_id: invitedUserId,
    role: "admin",
  });
  if (memberErr) {
    if (invitedUserId) await admin.auth.admin.deleteUser(invitedUserId);
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json(
      { error: "member_insert_failed", message: memberErr.message },
      { status: 500 },
    );
  }

  // 9. audit_log(from_contact_id でリード由来の発行を追跡可能に)
  await recordAuditLog({
    userId: invitedUserId,
    action: "admin_accessed_user",
    metadata: {
      event_subtype: "admin_created_organization",
      organization_id: organizationId,
      company_name: companyName,
      admin_email: adminEmail,
      from_contact_id: fromContactId ?? null,
      created_by_user_id: actor.id,
      created_by_email: actor.email ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    organizationId,
    invitedUserId,
    adminEmail,
  });
}
