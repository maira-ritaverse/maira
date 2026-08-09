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

import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements, type PlanEntitlements } from "@/lib/billing/plan-entitlements";
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
 * MFA(AAL2)強制。verified TOTP factor を持つユーザーが aal1(パスワードのみ)の
 * セッションで保護 API を叩いた場合に弾く。
 *
 * 経緯(監査 H2):
 *   MFA ゲートは lib/supabase/middleware.ts の positive-list
 *   (/app, /agency, /admin, /api/app|agency|admin)でのみ効いており、
 *   求職者データ API(/api/account/*, /api/resumes/*, /api/applications/* 等)は
 *   対象外だった。そのため MFA 有効化済みの求職者でもパスワードのみの aal1
 *   セッションで /api/account/export 等から復号済み個人データを抜けた。
 *   パス列挙は将来また漏れるため、認証ガード層(requireUser / requireOrgMember)で
 *   確実に塞ぐ。
 *
 * 返り値:
 *   ・null     → 問題なし(MFA 未設定 or 既に aal2)
 *   ・AuthFail → 403 mfa_required / 503 mfa_check_failed(middleware の API 分岐と同挙動)
 */
async function enforceAal2(supabase: SupabaseServerClient): Promise<AuthFail | null> {
  const aalRes = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalRes.error) {
    // fail-closed: 状態不明なので保護側に倒す(middleware と同じ)。
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "mfa_check_failed",
          message: "MFA 状態の確認に失敗しました。再度お試しください。",
        },
        { status: 503 },
      ),
    };
  }
  // nextLevel==='aal2'(= verified factor を保有)かつ currentLevel!=='aal2'
  // (= まだ TOTP 検証していない)のときだけ弾く。MFA 未設定ユーザーは nextLevel
  // が 'aal1' になるので何も起きない。
  if (aalRes.data?.nextLevel === "aal2" && aalRes.data?.currentLevel !== "aal2") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "mfa_required",
          message: "この操作には二段階認証が必要です。ログインし直してください。",
          redirectTo: "/login/mfa",
        },
        { status: 403 },
      ),
    };
  }
  return null;
}

/**
 * 「組織メンバーである」ことを保証する。admin / advisor どちらでも OK。
 * 失敗時は 401 / 403 の NextResponse を返す。
 *
 * archived ガード(2026-06-17 追加):
 *   ・profiles.archived_at NOT NULL なら 403 { error: "archived" }
 *   ・organizations.archived_at NOT NULL なら 403 { error: "organization_archived" }
 *   レイアウト側では signOut → /login?archived=1 で弾いているが、
 *   セッションが残るブラウザから API を直接叩かれる経路を塞ぐため、
 *   API 層でも独立して防御する(多層防御)。
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

  // archived チェック(ユーザ単位 + 組織単位を並列に取得)
  const [{ data: profileRow }, { data: orgRow }] = await Promise.all([
    supabase.from("profiles").select("archived_at").eq("id", user.id).maybeSingle(),
    supabase
      .from("organizations")
      .select("archived_at")
      .eq("id", role.organization.id)
      .maybeSingle(),
  ]);
  if ((profileRow as { archived_at: string | null } | null)?.archived_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: "archived" }, { status: 403 }),
    };
  }
  if ((orgRow as { archived_at: string | null } | null)?.archived_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: "organization_archived" }, { status: 403 }),
    };
  }

  // MFA(AAL2)強制(監査 H2)。middleware でも /api/agency は守られるが、
  // パス列挙漏れに強くするためガード層でも二重に確認する。
  const aalFail = await enforceAal2(supabase);
  if (aalFail) return aalFail;

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

  // archived ガード:profiles.archived_at が NOT NULL なら拒否。
  // 多層防御のため API 層でも独立して確認する(レイアウト側でも弾く)。
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("archived_at")
    .eq("id", user.id)
    .maybeSingle();
  if ((profileRow as { archived_at: string | null } | null)?.archived_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: "archived" }, { status: 403 }),
    };
  }

  // MFA(AAL2)強制(監査 H2)。求職者データ API(/api/account/*, /api/resumes/* 等)は
  // middleware の positive-list 外だったため、ここで確実に MFA を要求する。
  const aalFail = await enforceAal2(supabase);
  if (aalFail) return aalFail;

  return { ok: true, user, supabase };
}

/**
 * 現組織 の PlanEntitlements を 取得 する ヘルパー。
 *
 * プラン 未開始 (行 なし) は "standard" 相当 に フォールバック し 既存 挙動 を 維持。
 * (Solo 系 の 発行 は Phase 2 以降 の セルフサーブ 導線 で 開始 する ため、
 *  現時点 で 行 なし の 組織 = 招待 経由 の Team 顧客。)
 */
export async function getEntitlementsForOrg(
  supabase: SupabaseServerClient,
): Promise<PlanEntitlements> {
  const plan = await getCurrentOrganizationPlan(supabase);
  return getPlanEntitlements(plan?.tier ?? "standard");
}

/**
 * 「今 の 料金 プラン で は 使えない」 を 表す 402 レスポンス。
 * 認可 失敗 (403) と は 区別 する ため 402 (Payment Required) を 採用。
 * message は 日本語 で 具体 的 な アップグレード 誘導 を 含める こと。
 */
export function planUpgradeRequired(message: string): NextResponse {
  return NextResponse.json(
    {
      error: "feature_not_available",
      message,
    },
    { status: 402 },
  );
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
