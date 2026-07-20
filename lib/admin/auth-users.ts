/**
 * 運営者用: auth.users を 「id 集合」 で bulk 取得 する ヘルパー。
 *
 * 背景:
 *   Supabase の Admin API に は 「id の 配列 で 一括 取得」 API が 無く、
 *   `listUsers({page, perPage})` を ページ ごと に 順 に 呼んで 集約 する 必要
 *   が ある。 単純 に `perPage=200` で 1 ページ だけ 引く と 「200 を 超えた
 *   時点 で 一部 が 静かに 落ちる」 バグ に なる (実際 に 発生 して、
 *   /admin/seekers で page 2 以降 の seeker が 表示 されない、 /admin/clients
 *   で 担当 CA の email が null に なる 等)。
 *
 * 実装:
 *   ・targetIds に 含まれる user だけ を Map に 集める
 *   ・全 ページ を 走査 (最大 maxPages = 20 = 4000 users まで)
 *   ・全 target が 見つかった 時点 で 早期 return
 *   ・全 target が 見つからず 最終 ページ で も 未 到達 なら null で 埋まる
 *
 * ⚠️ maxPages は 4000 users 分 (200 * 20)。 プラットフォーム が それ 以上 に
 *    なったら 引き上げる か、 auth.users に 直接 SQL する RPC に 移行 する。
 *    現在 の MVP 規模 (< 数百) で は 十分。
 */
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const PER_PAGE = 200;
const MAX_PAGES = 20;

export type AuthUserSlim = {
  id: string;
  email: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
};

/**
 * 指定 した id 集合 に 対して auth.users を bulk 取得。 見つから ない id は Map に 入らない。
 */
export async function getAuthUsersByIds(
  admin: SupabaseClient,
  targetIds: Iterable<string>,
): Promise<Map<string, AuthUserSlim>> {
  const targets = new Set<string>(targetIds);
  const found = new Map<string, AuthUserSlim>();
  if (targets.size === 0) return found;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      // 途中 で 失敗 して も 集めた 分 は 返す。 呼出 側 で null フィールド の
      // フォールバック 表示 に なる (完全 な silent-drop より マシ)。
      console.warn("[admin/auth-users] listUsers page failed", { page, message: error.message });
      break;
    }
    const users = (data?.users ?? []) as User[];
    for (const u of users) {
      if (targets.has(u.id)) {
        found.set(u.id, {
          id: u.id,
          email: u.email ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          createdAt: u.created_at ?? null,
        });
      }
    }
    // 全 target を 見つけたら 早期 return
    if (found.size >= targets.size) return found;
    // 最終 ページ 判定: 200 未満 なら もう ページ は 無い
    if (users.length < PER_PAGE) break;
  }
  return found;
}
