/**
 * プライバシーポリシー同意状態のヘルパ。
 *
 * バージョン管理ポリシー:
 *   - 公開ポリシー文面([app/(marketing)/privacy/page.tsx](../../app/(marketing)/privacy/page.tsx))を
 *     法令対応 / 業務変更などで実質的に書き換えた時に
 *     CURRENT_PRIVACY_POLICY_VERSION の文字列を更新する
 *   - バージョンが更新されると、既存ユーザは次回ログイン時に再同意モーダルが出る
 *   - 文字列のフォーマットは「日付:YYYY-MM-DD」を推奨(運営側で見たときに直感的)
 *
 * 同意記録:
 *   - profiles.privacy_policy_accepted_at + profiles.privacy_policy_version に保存
 *   - audit_logs(action='privacy_policy_accepted')にもログを残す
 */

import { createClient } from "@/lib/supabase/server";

/**
 * 現在公開しているプライバシーポリシーのバージョン。
 * 文面を書き換えたら必ずここを更新すること。
 */
export const CURRENT_PRIVACY_POLICY_VERSION = "2026-06-15";

export type PolicyAcceptance = {
  acceptedAt: string | null;
  version: string | null;
};

/**
 * profiles から同意情報を取得。
 * 認証済前提(呼出側で auth を取り、user.id を渡すこと)。
 */
export async function getPolicyAcceptance(userId: string): Promise<PolicyAcceptance> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("privacy_policy_accepted_at, privacy_policy_version")
    .eq("id", userId)
    .maybeSingle();
  const row = data as {
    privacy_policy_accepted_at: string | null;
    privacy_policy_version: string | null;
  } | null;
  return {
    acceptedAt: row?.privacy_policy_accepted_at ?? null,
    version: row?.privacy_policy_version ?? null,
  };
}

/**
 * 同意モーダルを出すべきかの判定:
 *   - 未同意(acceptedAt = null)
 *   - 古いバージョン(version != CURRENT_PRIVACY_POLICY_VERSION)
 */
export function needsToAccept(p: PolicyAcceptance): boolean {
  if (!p.acceptedAt) return true;
  return p.version !== CURRENT_PRIVACY_POLICY_VERSION;
}
