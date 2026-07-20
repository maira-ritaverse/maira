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

/**
 * Solo プラン セルフサーブ サインアップ の 有効 フラグ。
 *
 * true の 場合 に のみ /signup/solo が 受付 開放 される。
 * env 未設定 or "false" の 場合 は Solo プラン 販売 前 の 段階 と 判定 して
 * /login に fallback する (信頼 領域 に 誰でも 個人 org を 作れて しまわない よう に)。
 *
 * 判定 順:
 *   1. NEXT_PUBLIC_SOLO_SIGNUP_ENABLED="true" (明示 flag)
 *   2. または 単純 に isOpenSignupEnabled() が true (自由登録 全体 が 開放 されて いる 場合、
 *      Solo signup も 自動 的 に 開放 する。 別 flag に する 意味 が 薄い)
 *
 * Stripe 側 の env (STRIPE_PRICE_SOLO_MONTHLY 等) の 有無 は 別 判定 で、
 * API 側 の isSoloStripeConfigured で 決済 誘導 or 無料 期間 の みで 進むか が 決まる。
 */
export function isSoloSignupEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_SOLO_SIGNUP_ENABLED === "true") return true;
  return isOpenSignupEnabled();
}
