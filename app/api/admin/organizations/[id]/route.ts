import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { sumEstimatedCost } from "@/lib/features/ai-pricing";
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
    // soft delete された メンバー は 一覧 に 出さない
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  const members = (membersData ?? []) as MemberRow[];

  // メンバーのメアド + 最終ログイン日 (auth.users) を解決。
  // memberCount 規模 (数〜数十) な ので getUserById を 並列 で 発火。
  const emailByUserId = new Map<string, string>();
  const lastSignInByUserId = new Map<string, string | null>();
  await Promise.all(
    members.map(async (m) => {
      try {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        if (data?.user?.email) emailByUserId.set(m.user_id, data.user.email);
        lastSignInByUserId.set(m.user_id, data?.user?.last_sign_in_at ?? null);
      } catch {
        // メアド / 最終ログイン取得失敗時は空のまま。UI 側でフォールバック表示。
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
  const cutoff30dIso = new Date(cutoff30d).toISOString();
  const isRecent = (iso: string) => new Date(iso).getTime() >= cutoff30d;

  // ── メンバー 別 稼働 集計 (直近 30 日)
  //    ・業務 アクション (clients / jobs / referrals / tasks の 新規 起票 数):
  //       全 テーブル に created_by_member_id が 追加 済 (20260719000001)。
  //       過去 データ は null な ので 実質 「昨日 以降 の 起票 分」 が 対象。
  //    ・LINE / メール 送信 は sent_by_* 列 が 未 実装 な ので per-user 集計 不可。
  //       この API で は 返さ ない (UI 側 で 注記)。
  //    ・AI 使用: ai_usage_events.user_id を 集計 (member.user_id に マッピング)。
  const memberIds = members.map((m) => m.id);
  const memberUserIds = members.map((m) => m.user_id);
  const memberIdList = memberIds.length > 0 ? memberIds : ["00000000-0000-0000-0000-000000000000"];
  const memberUserIdList =
    memberUserIds.length > 0 ? memberUserIds : ["00000000-0000-0000-0000-000000000000"];

  // 業務 アクション: 4 テーブル 並列 で 「member 別 起票 数」 を 集計。
  const [clientsCreated, jobsCreated, referralsCreated, tasksCreated, aiUsageRows] =
    await Promise.all([
      admin
        .from("client_records")
        .select("created_by_member_id")
        .eq("organization_id", id)
        .in("created_by_member_id", memberIdList)
        .gte("created_at", cutoff30dIso),
      admin
        .from("job_postings")
        .select("created_by_member_id")
        .eq("organization_id", id)
        .in("created_by_member_id", memberIdList)
        .gte("created_at", cutoff30dIso),
      admin
        .from("referrals")
        .select("created_by_member_id")
        .eq("organization_id", id)
        .in("created_by_member_id", memberIdList)
        .gte("created_at", cutoff30dIso),
      admin
        .from("agency_tasks")
        .select("created_by_member_id")
        .eq("organization_id", id)
        .in("created_by_member_id", memberIdList)
        .gte("created_at", cutoff30dIso),
      admin
        .from("ai_usage_events")
        .select("user_id, kind")
        .in("user_id", memberUserIdList)
        .gte("created_at", cutoff30dIso),
    ]);

  const countByMember = (
    rows: { created_by_member_id: string | null }[] | null | undefined,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const mid = r.created_by_member_id;
      if (!mid) continue;
      m.set(mid, (m.get(mid) ?? 0) + 1);
    }
    return m;
  };
  const clientsCreatedByMember = countByMember(
    clientsCreated.data as { created_by_member_id: string | null }[] | null,
  );
  const jobsCreatedByMember = countByMember(
    jobsCreated.data as { created_by_member_id: string | null }[] | null,
  );
  const referralsCreatedByMember = countByMember(
    referralsCreated.data as { created_by_member_id: string | null }[] | null,
  );
  const tasksCreatedByMember = countByMember(
    tasksCreated.data as { created_by_member_id: string | null }[] | null,
  );

  // AI 使用: user_id 別 に kind 別 カウント。 コスト は sumEstimatedCost で 算出。
  const aiByUser = new Map<string, Record<string, number>>();
  for (const r of (aiUsageRows.data ?? []) as { user_id: string; kind: string }[]) {
    const byKind = aiByUser.get(r.user_id) ?? {};
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    aiByUser.set(r.user_id, byKind);
  }

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
      const aiByKind = aiByUser.get(m.user_id) ?? {};
      const aiTotal = Object.values(aiByKind).reduce((s, n) => s + n, 0);
      return {
        id: m.id,
        userId: m.user_id,
        email: emailByUserId.get(m.user_id) ?? null,
        role: m.role,
        createdAt: m.created_at,
        clientCount: cs.total,
        linkedClientCount: cs.linked,
        recentClientsAdded30d: cs.recent30d,
        // 稼働 状況 (直近 30 日、 2026-07-19 に created_by_member_id 追加 済 の
        // ため 過去 分 は 集計 対象 外。 「新しい 起票 分」 の みが 見える 想定)
        lastSignInAt: lastSignInByUserId.get(m.user_id) ?? null,
        activity30d: {
          clients: clientsCreatedByMember.get(m.id) ?? 0,
          jobs: jobsCreatedByMember.get(m.id) ?? 0,
          referrals: referralsCreatedByMember.get(m.id) ?? 0,
          tasks: tasksCreatedByMember.get(m.id) ?? 0,
        },
        aiUsage30d: {
          total: aiTotal,
          byKind: aiByKind,
          estimatedCostJpy: sumEstimatedCost(aiByKind),
        },
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
const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("archive"),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("unarchive"),
  }),
  z.object({
    action: z.literal("set_recording_upload"),
    enabled: z.boolean(),
  }),
]);

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

  let update: Record<string, unknown>;
  let auditSubtype: string;
  let auditReason: string | null = null;
  if (parsed.data.action === "archive") {
    update = {
      archived_at: new Date().toISOString(),
      archived_reason: parsed.data.reason ?? null,
    };
    auditSubtype = "admin_archived_organization";
    auditReason = parsed.data.reason ?? null;
  } else if (parsed.data.action === "unarchive") {
    update = { archived_at: null, archived_reason: null };
    auditSubtype = "admin_unarchived_organization";
  } else {
    update = { recording_upload_enabled: parsed.data.enabled };
    auditSubtype = parsed.data.enabled
      ? "admin_enabled_recording_upload"
      : "admin_disabled_recording_upload";
  }

  const { error } = await admin.from("organizations").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  await recordAuditLog({
    userId: actor.id,
    action: "admin_accessed_user",
    metadata: {
      event_subtype: auditSubtype,
      organization_id: id,
      reason: auditReason,
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
 * auth.users の 扱い:
 *   ・以前 は 「他組織 で 使うかも しれない」 理由 で auth.users を 残していた が、
 *     結果 と して 「同じ メール で 再登録 → email_already_exists 409」 と なり
 *     「完全 削除 して やり直す」 が できない 状態 だった。
 *   ・本 実装 は 削除 対象 org の member だった user について、 以下 3 条件 を
 *     全 て 満たす 場合 のみ auth.users も 削除 する:
 *       (a) 他 organization_members に 所属 が 残って いない
 *       (b) profiles.is_maira_admin = false (Maira 運営 admin は 保護)
 *       (c) profiles.account_type = 'organization_member'
 *           (seeker アカウント は 別 系統 なので 触ら ない)
 *   ・profiles は auth.users への FK cascade で 連鎖 削除 される (追加 SQL 不要)。
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

  // ── 削除前 に メンバー の user_id を 収集 (org 削除 後 は org_members が
  //    cascade で 消えて しまう ため、 事前 に 取る 必要 が ある)
  const { data: memberRows } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", id)
    // 孤児 auth.users 判定 は active メンバー ベース で 行う
    .is("removed_at", null);
  const memberUserIds = Array.from(
    new Set(((memberRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );

  // 監査ログ(削除前)
  await recordAuditLog({
    userId: actor.id,
    action: "admin_accessed_user",
    metadata: {
      event_subtype: "admin_hard_deleted_organization",
      organization_id: org.id,
      organization_name: org.name,
      archived_at: org.archived_at,
      member_user_count: memberUserIds.length,
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

  // ── 孤児 auth.users の クリーンアップ。
  //    org 削除 後 なので、 残った organization_members を count すれば 「他 org
  //    に 所属 が 残って いる か」 が 判定 できる。
  //    プラット フォーム admin (is_maira_admin) と seeker は 対象外。
  //    1 件 でも 失敗 したら warn ログ のみ で 継続 (org 削除 は 成功 済み、
  //    残った auth.users は 手動 掃除 で 対応 する 方針)。
  let deletedUserCount = 0;
  for (const userId of memberUserIds) {
    try {
      // 他 org 所属 の 有無 (active な もの だけ 見て、 soft delete 済 は 「所属 なし」 扱い)
      const { count: otherMembershipCount, error: countErr } = await admin
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("removed_at", null);
      if (countErr) {
        console.warn("[admin/orgs/delete] membership count failed", { userId, err: countErr });
        continue;
      }
      if ((otherMembershipCount ?? 0) > 0) continue;

      // profiles で 運営 admin / account_type を 確認
      const { data: profileRow } = await admin
        .from("profiles")
        .select("is_maira_admin, account_type")
        .eq("id", userId)
        .maybeSingle();
      const prof = profileRow as {
        is_maira_admin: boolean | null;
        account_type: string | null;
      } | null;
      if (!prof) continue;
      if (prof.is_maira_admin === true) continue;
      if (prof.account_type !== "organization_member") continue;

      // 3 条件 満たした → auth.users 削除。 profiles は cascade で 消える。
      const { error: userDeleteErr } = await admin.auth.admin.deleteUser(userId);
      if (userDeleteErr) {
        console.warn("[admin/orgs/delete] auth user delete failed", {
          userId,
          message: userDeleteErr.message,
        });
        continue;
      }
      deletedUserCount++;
    } catch (err) {
      console.warn("[admin/orgs/delete] user cleanup exception", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 監査ログ に 削除 した user 数 を 追記 (2 行 目 として、 完了 の 事実 を 残す)
  if (deletedUserCount > 0) {
    await recordAuditLog({
      userId: actor.id,
      action: "admin_accessed_user",
      metadata: {
        event_subtype: "admin_hard_deleted_org_orphan_users",
        organization_id: org.id,
        organization_name: org.name,
        deleted_user_count: deletedUserCount,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
  }

  return NextResponse.json({
    ok: true,
    deletedName: org.name,
    deletedOrphanUserCount: deletedUserCount,
  });
}
