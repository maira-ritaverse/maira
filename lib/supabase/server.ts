import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * サーバー(Server Components / Route Handlers / Server Actions)で
 * 使用するSupabaseクライアント
 *
 * 使用例:
 * import { createClient } from "@/lib/supabase/server";
 *
 * const supabase = await createClient();
 *
 * パフォーマンス:
 *   React の cache() で 同一リクエスト内で 1 度しか 実行されない ように メモ化。
 *   旧 実装は 1 リクエスト内で 213 箇所 から 呼ばれ、その都度 新インスタンスを
 *   作って いた。クライアント生成自体は 軽量 だが、続く auth.getUser() / クエリ
 *   が JWT 検証 や DB 接続 で 累積していた。
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Componentから呼ばれた場合、cookieのsetは失敗する
            // (middlewareでセッション更新する設計なので問題ない)
          }
        },
      },
    },
  );
});

/**
 * 現在の ログインユーザー を 取得(React cache で メモ化)。
 *
 * 旧 パターン:185 箇所 で `supabase.auth.getUser()` を 直接 呼んでいた。
 * 1 リクエスト内 で middleware + layout + page + helpers と 重複 して 呼ばれ、
 * JWT 検証 が 毎回 走って いた。
 *
 * 本ヘルパーで cache() 化 した getCurrentUser() を 使えば 同一リクエスト内 で
 * 1 回 だけ 実行される。
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
