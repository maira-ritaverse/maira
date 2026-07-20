import { NextResponse } from "next/server";

import { getAuthUsersByIds } from "@/lib/admin/auth-users";
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

  // ── 1. まず profiles を account_type='seeker' で 絞って 取得。
  //     旧 実装 は 「listUsers({perPage:200}) → その 中 から seeker を 選ぶ」
  //     だった が、 auth.users が 200 を 超えた 時点 で seeker が 静かに 落ちる
  //     バグ (page 2 以降 の seeker が 一覧 に 出ない) が あった。 profiles 側 を
  //     ソース オブ トゥルース に 変える こと で 全件 拾える ように する。
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, display_name, account_type, onboarded_at, archived_at, archived_reason")
    .eq("account_type", "seeker");
  if (profErr) {
    return NextResponse.json(
      { error: "profile_lookup_failed", message: profErr.message },
      { status: 500 },
    );
  }
  const seekerProfiles = (profiles ?? []) as ProfileRow[];
  if (seekerProfiles.length === 0) {
    return NextResponse.json({ seekers: [], total: 0 });
  }

  // ── 2. auth.users から 該当 id 分 だけ email / last_sign_in_at を bulk 取得
  //     (getAuthUsersByIds は 内部 で listUsers を 全 ページ 走査 する)
  const authUsersById = await getAuthUsersByIds(
    admin,
    seekerProfiles.map((p) => p.id),
  );

  // メール 検索 は auth 取得 後 に JS 側 で 部分 一致 で 絞る
  const seekerIds = seekerProfiles
    .filter((p) => {
      if (!q) return true;
      const email = authUsersById.get(p.id)?.email ?? "";
      return email.toLowerCase().includes(q);
    })
    .map((p) => p.id);
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

  // ── 4. seeker ごと の レコード を 組み立て。
  //     seekerIds は q フィルタ 後 の profile.id リスト。 対応 auth 情報 は
  //     authUsersById から 引く (無ければ null で 埋める; auth 側 で 削除 された
  //     ケース や listUsers ページ 走査 が 打ち切ら れた 場合 の フォールバック)。
  const seekers = seekerIds
    .map((id) => {
      const p = profileMap.get(id) as ProfileRow;
      const au = authUsersById.get(id);
      return {
        id,
        email: au?.email ?? "",
        displayName: p.display_name,
        createdAt: au?.createdAt ?? null,
        lastSignInAt: au?.lastSignInAt ?? null,
        onboardedAt: p.onboarded_at,
        archivedAt: p.archived_at,
        archivedReason: p.archived_reason,
        resumeCount: resumesByUser.get(id) ?? 0,
        applicationCount: applicationsByUser.get(id) ?? 0,
        conversationCount: conversationsByUser.get(id) ?? 0,
        linkedAgencyCount: linkedOrgsByUser.get(id)?.size ?? 0,
      };
    })
    .filter((s) => (showArchived ? s.archivedAt !== null : s.archivedAt === null))
    .sort((a, b) => {
      if (showArchived) {
        return (b.archivedAt ?? "") > (a.archivedAt ?? "") ? 1 : -1;
      }
      return (a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1;
    });

  return NextResponse.json({ seekers, total: seekers.length });
}
