/**
 * API ルート共通の認証 / 認可ガード
 *
 * 何回も繰り返し書いていた次のパターンを集約:
 *
 *   const supabase = await createClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 *   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   const role = await getUserRole(user.id);
 *   if (role.accountType !== "organization_member" || !role.organization || !role.member) {
 *     return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 *   }
 *
 * ルートでの使い方は:
 *
 *   const guard = await requireOrgMember();
 *   if (!guard.ok) return guard.response;
 *   const { user, organization, member, supabase } = guard;
 *
 * という Discriminated Union パターン。早期 return しやすく、TS が
 * ok=true 後のフィールドを narrow する。
 *
 * 注意:
 *   - guard 関数の中で createClient() を 1 回呼ぶので、ルート側で改めて呼ばないように
 *   - supabase クライアントを再利用したいので guard の戻り値に含める
 */
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type OrgMemberContext = {
  ok: true;
  user: User;
  organization: { id: string; name: string };
  member: { id: string; role: "admin" | "advisor" };
  supabase: SupabaseServerClient;
};

export type AuthFail = {
  ok: false;
  response: NextResponse;
};

/**
 * 「組織メンバーである」ことを保証する。admin / advisor どちらでも OK。
 * 失敗時は 401 / 403 の NextResponse を返す。
 */
export async function requireOrgMember(): Promise<OrgMemberContext | AuthFail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user,
    organization: { id: role.organization.id, name: role.organization.name },
    member: { id: role.member.id, role: role.member.role as "admin" | "advisor" },
    supabase,
  };
}

/**
 * 組織メンバー + admin であることを保証する。
 */
export async function requireOrgAdmin(): Promise<OrgMemberContext | AuthFail> {
  const result = await requireOrgMember();
  if (!result.ok) return result;
  if (result.member.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin only" }, { status: 403 }),
    };
  }
  return result;
}

/**
 * 認証済みの user(seeker / member 問わず)を返す。
 * 用途:/api/account/... など組織を問わない個人 API。
 */
export type AuthedUserContext = {
  ok: true;
  user: User;
  supabase: SupabaseServerClient;
};

export async function requireUser(): Promise<AuthedUserContext | AuthFail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, user, supabase };
}

/**
 * 共通 JSON ボディパース。失敗時は 400。
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const body = await request.json();
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}
