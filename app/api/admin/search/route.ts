import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/search?q=<query>
 *
 * 運営者用:Cmd+K パレットの統合検索。
 *
 * 検索対象:
 *   - users:auth.users.email 部分一致(最大 5 件)
 *   - organizations:organizations.name 部分一致(最大 5 件)
 *   - contacts:contact_messages.company / name / email 部分一致(最大 5 件)
 *
 * 認可:
 *   - isMairaAdmin() 必須
 *
 * パフォーマンス:
 *   - q が短すぎる(2 文字未満)場合は早期 return
 *   - auth.users 検索は listUsers(perPage=200)取得 → JS で string match
 *     (Supabase Admin API は ilike をサーバ側サポートしないため)
 *   - organizations / contacts は ilike で DB 側絞り込み + 5 件 limit
 */
type OrgResult = { id: string; name: string };
type UserResult = { id: string; email: string };
type ContactResult = { id: string; company: string; name: string; email: string };

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ users: [], organizations: [] });
  }
  const qLower = q.toLowerCase();

  const admin = createServiceClient();

  // ilike エスケープ:ワイルドカード混入を防ぐ(共通)
  const escaped = q.replace(/([\\%_])/g, "\\$1");
  const pattern = `%${escaped}%`;

  // 並列で 3 種類を検索
  const [usersResult, orgsResult, contactsResult] = await Promise.all([
    (async (): Promise<UserResult[]> => {
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (error) return [];
      return data.users
        .filter((u) => (u.email ?? "").toLowerCase().includes(qLower))
        .slice(0, 5)
        .map((u) => ({ id: u.id, email: u.email ?? "" }));
    })(),
    (async (): Promise<OrgResult[]> => {
      const { data, error } = await admin
        .from("organizations")
        .select("id, name")
        .ilike("name", pattern)
        .limit(5);
      if (error) return [];
      return (data ?? []) as OrgResult[];
    })(),
    (async (): Promise<ContactResult[]> => {
      const { data, error } = await admin
        .from("contact_messages")
        .select("id, company, name, email")
        .or(`company.ilike.${pattern},name.ilike.${pattern},email.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data ?? []) as ContactResult[];
    })(),
  ]);

  return NextResponse.json({
    users: usersResult,
    organizations: orgsResult,
    contacts: contactsResult,
  });
}
