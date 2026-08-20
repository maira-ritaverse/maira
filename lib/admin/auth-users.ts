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
  /** auth.users.last_sign_in_at(明示的なサインイン時のみ更新。日々の利用では更新されない)。 */
  lastSignInAt: string | null;
  /** profiles.last_seen_at(認証後レイアウト表示ごとに更新、5 分スロットル)。 */
  lastSeenAt: string | null;
  /** lastSignInAt と lastSeenAt の新しい方 = 実質の最終アクセス。運営者画面の表示に使う。 */
  lastAccessAt: string | null;
  createdAt: string | null;
};

/** ISO 日時文字列 a, b の新しい方を返す(null は無視)。フォーマット差異に強い getTime 比較。 */
function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * 収集済みの AuthUserSlim に profiles.last_seen_at を合流させ、lastAccessAt を確定する。
 *
 * last_sign_in_at は明示サインイン時しか更新されないため、それだけだと「毎日使っている
 * のに数週間前」になり最終アクセスの精度が悪い。認証後レイアウトで更新している
 * last_seen_at と突き合わせ、新しい方を lastAccessAt(= 実質の最終アクセス)とする。
 * 取得失敗時は last_sign_in_at ベース(初期値)のままにする。
 */
async function enrichWithLastSeen(
  admin: SupabaseClient,
  found: Map<string, AuthUserSlim>,
): Promise<void> {
  const ids = [...found.keys()];
  if (ids.length === 0) return;
  const { data, error } = await admin.from("profiles").select("id, last_seen_at").in("id", ids);
  if (error) {
    console.warn("[admin/auth-users] profiles last_seen_at fetch failed", {
      message: error.message,
    });
    return;
  }
  for (const row of data ?? []) {
    const slim = found.get(row.id as string);
    if (!slim) continue;
    const lastSeenAt = (row.last_seen_at as string | null) ?? null;
    slim.lastSeenAt = lastSeenAt;
    slim.lastAccessAt = laterIso(slim.lastSignInAt, lastSeenAt);
  }
}

/**
 * 指定 した id 集合 に 対して auth.users を bulk 取得。 見つから ない id は Map に 入らない。
 * 最終 ページ 到達 前 に MAX_PAGES を 使い 切って 未 発見 の target が 残った 場合、
 * 明示的 に warn を 吐く (silent-drop の 監視 の ため)。
 *
 * 取得後、profiles.last_seen_at を合流させて lastAccessAt を確定する
 * (最終アクセス表示の精度向上。詳細は enrichWithLastSeen を参照)。
 */
export async function getAuthUsersByIds(
  admin: SupabaseClient,
  targetIds: Iterable<string>,
): Promise<Map<string, AuthUserSlim>> {
  const targets = new Set<string>(targetIds);
  const found = new Map<string, AuthUserSlim>();
  if (targets.size === 0) return found;

  let reachedEnd = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
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
          // last_seen_at は下の enrichWithLastSeen で合流。ここでは sign_in を初期値に。
          lastSeenAt: null,
          lastAccessAt: u.last_sign_in_at ?? null,
          createdAt: u.created_at ?? null,
        });
      }
    }
    // 全 target 発見でも、profiles 合流のためループを抜けてから enrich する。
    if (found.size >= targets.size) break;
    if (users.length < PER_PAGE) {
      reachedEnd = true;
      break;
    }
  }
  // MAX_PAGES 使い 切って 未 発見 target が 残って いる → プラット フォーム が
  // MAX_PAGES × PER_PAGE を 超えて 拡大 した 兆候。 admin 表示 の 精度 が 落ちる
  // 前 に モニタリング に 上げる。
  if (!reachedEnd && found.size < targets.size) {
    console.warn("[admin/auth-users] MAX_PAGES reached before finding all targets", {
      targets: targets.size,
      found: found.size,
      maxUsersScanned: MAX_PAGES * PER_PAGE,
    });
  }

  await enrichWithLastSeen(admin, found);
  return found;
}

/**
 * email で auth.users を 検索 (存在 確認 用)。 見つかれば User を、 無ければ null を 返す。
 * listUsers を 全 ページ 走査 する (Supabase Admin API に getUserByEmail が 無い ため)。
 */
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      console.warn("[admin/auth-users] findAuthUserByEmail page failed", {
        page,
        message: error.message,
      });
      return null;
    }
    const users = (data?.users ?? []) as User[];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === needle);
    if (hit) return hit;
    if (users.length < PER_PAGE) return null;
  }
  // MAX_PAGES 使い 切って 見つから ず = 実際 に 存在 しない か、 4000 users を
  // 超えた か。 呼出 側 の 挙動 は 「見つからない = 新規 発行 可能」 な の で、
  // 万が 一 該当 が 4000+ 目 に あった 場合 は 後段 の invite で email_exists が
  // 返って rollback で 復旧 する 前提。 モニタリング に は 出す。
  console.warn("[admin/auth-users] findAuthUserByEmail exhausted MAX_PAGES", {
    maxUsersScanned: MAX_PAGES * PER_PAGE,
  });
  return null;
}
