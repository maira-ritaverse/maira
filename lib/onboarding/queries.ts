import { createClient } from "@/lib/supabase/server";

/**
 * オンボーディング完了状態を取得する。
 *
 * profiles.onboarded_at が null かどうかで判定する。
 * 値が入っていれば「ツアー完了済み」、null なら「未完了」として扱う。
 *
 * Server Component から呼び出される前提。
 *
 * @returns true: 完了済み / false: 未完了
 */
export async function isOnboardingCompleted(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle();

  return data?.onboarded_at !== null && data?.onboarded_at !== undefined;
}
