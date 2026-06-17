import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/organizations/[id]
 *
 * 運営者用:エージェント企業 1 社の詳細。
 *
 * 返すもの:
 *   - 企業情報(name / createdAt)
 *   - メンバー一覧(email / role / 担当クライアント数)
 *   - 集計(advisor 数 / client 数 / linked 数 / 求人数)
 *
 * 認可:isMairaAdmin ガード(レイアウト + API 二重)。
 */
type RouteParams = { params: Promise<{ id: string }> };

type OrgRow = {
  id: string;
  name: string;
  created_at: string;
};
type MemberRow = {
  id: string;
  user_id: string;
  role: "admin" | "advisor";
  created_at: string;
};
type ClientRow = {
  id: string;
  assigned_member_id: string | null;
  link_status: string;
  created_at: string;
};
type JobRow = { id: string; created_at: string };
type ReferralRow = { id: string; created_at: string };

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createServiceClient();

  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (orgErr || !orgRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const org = orgRow as OrgRow;

  // メンバー
  const { data: membersData } = await admin
    .from("organization_members")
    .select("id, user_id, role, created_at")
    .eq("organization_id", id)
    .order("created_at", { ascending: true });
  const members = (membersData ?? []) as MemberRow[];

  // メンバーのメアド(auth.users)を解決(memberCount 規模なので個別取得で十分)
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    members.map(async (m) => {
      try {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        if (data?.user?.email) emailByUserId.set(m.user_id, data.user.email);
      } catch {
        // メアド取得失敗時は空のまま。UI 側でフォールバック表示。
      }
    }),
  );

  // クライアント
  const { data: clientsData } = await admin
    .from("client_records")
    .select("id, assigned_member_id, link_status, created_at")
    .eq("organization_id", id);
  const clients = (clientsData ?? []) as ClientRow[];

  // 求人
  const { data: jobsData } = await admin
    .from("job_postings")
    .select("id, created_at")
    .eq("organization_id", id);
  const jobs = (jobsData ?? []) as JobRow[];

  // 紹介(referrals)— 直近 30 日のアクティビティ算出に使用
  const { data: referralsData } = await admin
    .from("referrals")
    .select("id, created_at")
    .eq("organization_id", id);
  const referrals = (referralsData ?? []) as ReferralRow[];

  // 30 日前カットオフ
  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const isRecent = (iso: string) => new Date(iso).getTime() >= cutoff30d;

  // 担当 client 数(member.id でグルーピング)+ 各 member の直近 30 日新規 client
  const clientsByMember = new Map<string, { total: number; linked: number; recent30d: number }>();
  let unassignedClients = 0;
  let unassignedLinked = 0;
  for (const c of clients) {
    if (c.assigned_member_id) {
      const cur = clientsByMember.get(c.assigned_member_id) ?? {
        total: 0,
        linked: 0,
        recent30d: 0,
      };
      cur.total += 1;
      if (c.link_status === "linked") cur.linked += 1;
      if (isRecent(c.created_at)) cur.recent30d += 1;
      clientsByMember.set(c.assigned_member_id, cur);
    } else {
      unassignedClients += 1;
      if (c.link_status === "linked") unassignedLinked += 1;
    }
  }

  const adminCount = members.filter((m) => m.role === "admin").length;
  const advisorCount = members.filter((m) => m.role === "advisor").length;
  const linkedClientCount = clients.filter((c) => c.link_status === "linked").length;

  // 直近 30 日のアクティビティ集計(企業全体)
  const recent30d = {
    clientsAdded: clients.filter((c) => isRecent(c.created_at)).length,
    jobsAdded: jobs.filter((j) => isRecent(j.created_at)).length,
    referralsCreated: referrals.filter((r) => isRecent(r.created_at)).length,
  };

  return NextResponse.json({
    organization: {
      id: org.id,
      name: org.name,
      createdAt: org.created_at,
    },
    summary: {
      adminCount,
      advisorCount,
      memberCount: members.length,
      clientCount: clients.length,
      linkedClientCount,
      jobCount: jobs.length,
    },
    recent30d,
    members: members.map((m) => {
      const cs = clientsByMember.get(m.id) ?? { total: 0, linked: 0, recent30d: 0 };
      return {
        id: m.id,
        userId: m.user_id,
        email: emailByUserId.get(m.user_id) ?? null,
        role: m.role,
        createdAt: m.created_at,
        clientCount: cs.total,
        linkedClientCount: cs.linked,
        recentClientsAdded30d: cs.recent30d,
      };
    }),
    unassigned: {
      clientCount: unassignedClients,
      linkedClientCount: unassignedLinked,
    },
  });
}

/**
 * PATCH /api/admin/organizations/[id]
 *
 * 組織のアーカイブ / 復活操作(運営者専用)。
 * 物理削除はせず、archived_at にタイムスタンプを記録するソフトデリート方式。
 *
 * Body:
 *   { action: "archive" | "unarchive", reason?: string }
 *
 * archive:
 *   ・archived_at = now()、archived_reason = body.reason ?? null
 *   ・組織配下のクライアント / 求人 / メンバーは残す(履歴参照のため)
 * unarchive:
 *   ・archived_at = null、archived_reason = null
 *
 * 監査ログ:admin_accessed_user を流用(action 自体は organization 単位だが
 *          audit テーブルの enum 制限を避ける目的で event_subtype で分ける)
 */
const patchSchema = z.object({
  action: z.enum(["archive", "unarchive"]),
  reason: z.string().max(500).optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user: actor } = guard;

  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = patchSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const { id } = await params;
  const admin = createServiceClient();

  const update =
    parsed.data.action === "archive"
      ? {
          archived_at: new Date().toISOString(),
          archived_reason: parsed.data.reason ?? null,
        }
      : { archived_at: null, archived_reason: null };

  const { error } = await admin.from("organizations").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  await recordAuditLog({
    userId: actor.id,
    action: "admin_accessed_user",
    metadata: {
      event_subtype:
        parsed.data.action === "archive"
          ? "admin_archived_organization"
          : "admin_unarchived_organization",
      organization_id: id,
      reason: parsed.data.reason ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/organizations/[id]
 *
 * 運営者用:エージェント企業を物理削除する不可逆操作。
 *
 * ⚠️ 履歴(client_records / referrals / job_postings / interactions / 通知等)も
 *    すべて FK の on delete cascade で連鎖削除される。元に戻せない。
 *    UI 側からは「退会済タブで、すでに archived の組織にのみ」表示する。
 *
 * 連鎖されないもの:
 *   ・auth.users(管理者 / アドバイザー個人アカウント自体は残す。
 *     その人が別組織で使うかもしれないため)
 *
 * 安全策:
 *   ・isMairaAdmin ガード
 *   ・archived_at が null の組織(=現役)を完全削除させない(誤操作防止)
 *     UI 側のガードと二重で。
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user: actor } = guard;

  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createServiceClient();

  // 対象の name と archived_at を事前取得(監査ログ + 現役チェック)
  const { data: orgRow, error: lookupErr } = await admin
    .from("organizations")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { error: "lookup_failed", message: lookupErr.message },
      { status: 500 },
    );
  }
  if (!orgRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const org = orgRow as { id: string; name: string; archived_at: string | null };

  // 現役組織の即時物理削除は禁止(まず archive してから消す運用)
  if (!org.archived_at) {
    return NextResponse.json(
      { error: "not_archived", message: "現役の組織は先に退会済に移動してください" },
      { status: 400 },
    );
  }

  // 監査ログ(削除前)
  await recordAuditLog({
    userId: actor.id,
    action: "admin_accessed_user",
    metadata: {
      event_subtype: "admin_hard_deleted_organization",
      organization_id: org.id,
      organization_name: org.name,
      archived_at: org.archived_at,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  const { error: deleteErr } = await admin.from("organizations").delete().eq("id", id);
  if (deleteErr) {
    return NextResponse.json(
      { error: "delete_failed", message: deleteErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, deletedName: org.name });
}
