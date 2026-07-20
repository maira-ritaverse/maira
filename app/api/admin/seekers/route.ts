import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/seekers?q=<email>&archived=<bool>
 *
 * 運営者用: 求職者 (profiles.account_type='seeker') 一覧。
 *
 * 「/admin/users」 は 全 ユーザー (seeker + organization_member + admin) の 汎用
 * リスト な の で、 求職者 に 特化 した 情報 (履歴書 数 / 応募 数 / 連携 CA 社数
 * 等) を 見る に は 別 経路 が 必要。 この endpoint は seeker だけ を 絞って、
 * 稼働 状況 の 判定 に 使う 数値 を 一緒 に 返す。
 *
 * データ ソース:
 *   ・auth.users (listUsers)  — email / created_at / last_sign_in_at
 *   ・profiles                 — display_name / onboarded_at / archived_at
 *   ・resumes / applications / conversations — count(user_id) で 集計
 *   ・client_records (linked)  — 連携 CA 組織 数
 *
 * 認可: isMairaAdmin ガード。
 *
 * 規模: MVP 想定 で 200 件 まで の 全件 取得。 seekers が 数千 を 超えたら
 * ページング と DB 側 集計 RPC に 切り替える。
 */

type ProfileRow = {
  id: string;
  display_name: string | null;
  account_type: string | null;
  onboarded_at: string | null;
  archived_at: string | null;
  archived_reason: string | null;
};

type CountRow = { user_id: string };

type ClientLinkRow = {
  linked_user_id: string;
  organization_id: string;
};

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const showArchived = url.searchParams.get("archived") === "true";

  const admin = createServiceClient();

  // ── 1. 全 auth.users を まず 取得 (MVP は 200 件 / 1 page)
  const { data: authList, error: authErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (authErr) {
    return NextResponse.json({ error: "list_failed", message: authErr.message }, { status: 500 });
  }

  // メール で 検索 (auth 側 は 部分一致 サーバー サポート なし)
  const authFiltered = q
    ? authList.users.filter((u) => (u.email ?? "").toLowerCase().includes(q))
    : authList.users;
  const authIds = authFiltered.map((u) => u.id);

  if (authIds.length === 0) {
    return NextResponse.json({ seekers: [], total: 0 });
  }

  // ── 2. profiles を join (account_type='seeker' で 絞る)
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, display_name, account_type, onboarded_at, archived_at, archived_reason")
    .in("id", authIds)
    .eq("account_type", "seeker");
  if (profErr) {
    return NextResponse.json(
      { error: "profile_lookup_failed", message: profErr.message },
      { status: 500 },
    );
  }
  const seekerProfiles = (profiles ?? []) as ProfileRow[];
  const seekerIds = seekerProfiles.map((p) => p.id);
  const profileMap = new Map(seekerProfiles.map((p) => [p.id, p]));

  if (seekerIds.length === 0) {
    return NextResponse.json({ seekers: [], total: 0 });
  }

  // ── 3. 稼働 数値 を 並列 集計 (履歴書 / 応募 / 会話 / 連携 CA)
  //     全 テーブル に対し 「user_id, id を 取って JS で group by」 する。
  //     head:true + count:exact だと per-user カウント が 得られ ない ので、
  //     行 全体 を 引いて JS 側 で bucket する 方針 (MVP 規模)。
  const [resumes, applications, conversations, links] = await Promise.all([
    admin.from("resumes").select("user_id").in("user_id", seekerIds),
    admin.from("applications").select("user_id").in("user_id", seekerIds),
    admin.from("conversations").select("user_id").in("user_id", seekerIds),
    admin
      .from("client_records")
      .select("linked_user_id, organization_id")
      .in("linked_user_id", seekerIds)
      .eq("link_status", "linked"),
  ]);

  const bucketCount = (rows: CountRow[] | null | undefined): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const uid = r.user_id;
      if (!uid) continue;
      m.set(uid, (m.get(uid) ?? 0) + 1);
    }
    return m;
  };
  const resumesByUser = bucketCount(resumes.data as CountRow[] | null);
  const applicationsByUser = bucketCount(applications.data as CountRow[] | null);
  const conversationsByUser = bucketCount(conversations.data as CountRow[] | null);

  // 連携 CA は 「distinct organization_id 数」 を per-user で 出す
  const linkedOrgsByUser = new Map<string, Set<string>>();
  for (const l of (links.data ?? []) as ClientLinkRow[]) {
    if (!l.linked_user_id || !l.organization_id) continue;
    const set = linkedOrgsByUser.get(l.linked_user_id) ?? new Set<string>();
    set.add(l.organization_id);
    linkedOrgsByUser.set(l.linked_user_id, set);
  }

  // ── 4. seeker ごと の レコード を 組み立て
  const seekers = authFiltered
    .filter((u) => profileMap.has(u.id))
    .map((u) => {
      const p = profileMap.get(u.id) as ProfileRow;
      return {
        id: u.id,
        email: u.email ?? "",
        displayName: p.display_name,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        onboardedAt: p.onboarded_at,
        archivedAt: p.archived_at,
        archivedReason: p.archived_reason,
        resumeCount: resumesByUser.get(u.id) ?? 0,
        applicationCount: applicationsByUser.get(u.id) ?? 0,
        conversationCount: conversationsByUser.get(u.id) ?? 0,
        linkedAgencyCount: linkedOrgsByUser.get(u.id)?.size ?? 0,
      };
    })
    // archived フィルタ (archived=true なら 停止 中 のみ)
    .filter((s) => (showArchived ? s.archivedAt !== null : s.archivedAt === null))
    // 現役 は 登録日 が 新しい 順、 停止中 は アーカイブ日 が 新しい 順
    .sort((a, b) => {
      if (showArchived) {
        return (b.archivedAt ?? "") > (a.archivedAt ?? "") ? 1 : -1;
      }
      return a.createdAt < b.createdAt ? 1 : -1;
    });

  return NextResponse.json({ seekers, total: seekers.length });
}
