import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * サーバー(Server Components / Route Handlers / Server Actions)で
 * 使用するSupabaseクライアント
 *
 * 使用例:
 * import { createClient } from "@/lib/supabase/server";
 *
 * const supabase = await createClient();
 */
export async function createClient() {
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
}
