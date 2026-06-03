"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SignupInput, LoginInput } from "@/lib/validations/auth";

/**
 * 新規登録 Server Action
 *
 * Supabase Authでアカウントを作成し、確認メールを送信する。
 * emailRedirectToでメール内リンクのクリック後のリダイレクト先を指定。
 *
 * invitationToken が渡されている場合(招待経由のサインアップ):
 *   emailRedirectTo に next=/invite/[token] を付ける。
 *   → メール確認後 callback → /invite/[token] に戻り、S5a の受諾フローに乗る。
 *   ※ token 自体の検証は /invite/[token] 着地ページと RPC で行うため、
 *     ここでは「リダイレクト先を組み立てる文字列」としてのみ扱う。
 *     URL に直接埋め込むので、文字数の上限(256)はバリデーション側で担保している。
 */
export async function signup(input: SignupInput) {
  const supabase = await createClient();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const callbackBase = `${siteUrl}/auth/callback`;
  const emailRedirectTo = input.invitationToken
    ? `${callbackBase}?next=${encodeURIComponent(`/invite/${input.invitationToken}`)}`
    : callbackBase;

  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo,
      data: {
        display_name: input.displayName,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

/**
 * ログイン Server Action
 *
 * 成功時はlayoutキャッシュを破棄して /app にリダイレクトする。
 * 失敗時はエラーメッセージを返す(クライアント側で表示)。
 */
export async function login(input: LoginInput) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/app");
}

/**
 * ログアウト Server Action
 */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/auth/login");
}
