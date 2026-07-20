/**
 * MFA (二段階認証) 用 ヘルパー。
 *
 * Supabase Auth の 提供 する TOTP MFA を 薄く 包む。 セキュリティ 監査 A2 の 対応
 * として 導入。 パスワード 単体 だと credential stuffing / phishing に 弱い ため、
 * 認証 アプリ (Google Authenticator / 1Password / Authy 等) 経由 の 時刻 依存
 * ワンタイム コード (RFC 6238) を 2 段目 に 挟む。
 *
 * 方針:
 *   ・opt-in (全 ユーザー が settings/security から 有効 化)
 *   ・enroll (登録) → challenge + verify (コード 照合) で 「verified」 状態 に なり、
 *     セッション の AAL が aal1 → aal2 に 昇格 する
 *   ・「有効 化 済 = verified factor が 存在」 は listUserFactors で 判定 でき、
 *     login 後 の middleware で aal1 セッション を 検知 したら /login/mfa に redirect
 *
 * MFA テーブル 追加 は 不要 (auth.mfa_factors は Supabase Auth 側 で 自動 管理)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaFactorType = "totp" | "phone" | "webauthn";
export type MfaFactorStatus = "verified" | "unverified";

export type MfaFactorSummary = {
  id: string;
  friendlyName: string | null;
  factorType: MfaFactorType;
  status: MfaFactorStatus;
  createdAt: string;
};

/**
 * ユーザー の MFA factor 一覧 を 取得 (verified / unverified 両方)。
 * 未 認証 (session が 無い) の 呼出 は 空 配列 を 返す。
 */
export async function listUserFactors(supabase: SupabaseClient): Promise<MfaFactorSummary[]> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error || !data) return [];
    return data.all.map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      factorType: f.factor_type as MfaFactorType,
      status: f.status as MfaFactorStatus,
      createdAt: f.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * verified な TOTP factor を 1 つ でも 持って いる か。
 * middleware / login 後 の redirect 判定 に 使う。
 */
export async function hasVerifiedTotpFactor(supabase: SupabaseClient): Promise<boolean> {
  const factors = await listUserFactors(supabase);
  return factors.some((f) => f.factorType === "totp" && f.status === "verified");
}

/**
 * verified な factor の うち 最初 の 1 件 を 返す (login 後 の 自動 challenge 用)。
 * 未 verified factor は 除外 する (未完了 の enroll を login 経路 で 引き ずら ない)。
 */
export async function getFirstVerifiedTotpFactorId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const factors = await listUserFactors(supabase);
  const verified = factors.find((f) => f.factorType === "totp" && f.status === "verified");
  return verified?.id ?? null;
}
