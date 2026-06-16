import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/users?q=<query>&page=<n>
 *
 * 運営者用:ユーザ(auth.users)一覧を返す。検索 q が指定されていれば
 * email 部分一致でフィルタ。
 *
 * 設計:
 *   - 認可:isMairaAdmin() のみ通す
 *   - データソース:
 *       auth.users(service_role.auth.admin.listUsers)
 *     + profiles(account_type / is_maira_admin / onboarded_at)
 *   - メアド検索は auth.admin.listUsers() 経由でページごとに取得 → 文字列マッチ
 *     (Supabase の admin API は email 部分一致をサーバ側でサポートしない)
 *   - 大量データは想定しない MVP 規模なので 200 件取って絞り込む実装で OK
 *
 * レスポンス:
 *   { users: [{ id, email, createdAt, accountType, isMairaAdmin, onboardedAt }] }
 */
export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const admin = createServiceClient();
  // page=1, perPage=200(MVP 規模での全件取得)。本番でユーザ数が増えたらページング実装。
  const { data: list, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) {
    return NextResponse.json({ error: "list_failed", message: error.message }, { status: 500 });
  }

  const matched = q
    ? list.users.filter((u) => (u.email ?? "").toLowerCase().includes(q))
    : list.users;

  const ids = matched.map((u) => u.id);
  // profiles を別途読む(account_type / is_maira_admin / onboarded_at)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, account_type, is_maira_admin, onboarded_at")
    .in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      (p as { id: string }).id,
      p as {
        id: string;
        account_type: string;
        is_maira_admin: boolean;
        onboarded_at: string | null;
      },
    ]),
  );

  const users = matched
    .map((u) => {
      const p = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        createdAt: u.created_at,
        accountType: p?.account_type ?? "unknown",
        isMairaAdmin: p?.is_maira_admin ?? false,
        onboardedAt: p?.onboarded_at ?? null,
      };
    })
    // 新しい順
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({ users, total: users.length });
}
