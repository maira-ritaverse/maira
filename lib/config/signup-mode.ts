/**
 * オープンサインアップ(自由登録)のフラグ管理。
 *
 * 運用モード:
 *   - **BtoBtoC モード(デフォルト)**:
 *     自由登録は不可。アカウント発行は次の 2 経路のみ。
 *       a. /admin から「組織 + 管理者 1 人」を発行(Supabase 招待メール)
 *       b. エージェント企業 admin → 組織内メンバー招待(/invite/[token])
 *
 *   - **オープンモード(C 向け展開時)**:
 *     `NEXT_PUBLIC_OPEN_SIGNUP_ENABLED="true"` で /signup から誰でも自由登録可能。
 *
 * 設計意図:
 *   - 環境変数フラグで切替できるようにし、コードを書き換えずに B/C モードを変えられる。
 *   - NEXT_PUBLIC_ プレフィックスにすることで LP / クライアントコンポーネントでも
 *     登録ボタンの出し分けに使える。
 *
 * 例外(常に許可される経路):
 *   - 組織内招待トークン経由(/signup?invitationToken=...):
 *     既存ユーザを招き入れる正規ルートなので、本フラグの影響を受けない。
 *   - Supabase Auth の招待メール経由(/auth/callback?type=invite):
 *     admin が auth.admin.inviteUserByEmail で送るリンクで、Supabase 標準フロー。
 */

export function isOpenSignupEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OPEN_SIGNUP_ENABLED === "true";
}
