"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SignupInput, LoginInput } from "@/lib/validations/auth";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { safeNextOr } from "@/lib/auth/safe-next";
import { isOpenSignupEnabled } from "@/lib/config/signup-mode";

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
  // BtoBtoC モード:招待トークン無しの自由登録は API レベルでも拒否する
  // (UI でガードしていても URL を直接叩く / 古いタブからの送信を防ぐ)
  if (!input.invitationToken && !isOpenSignupEnabled()) {
    return { error: "自由登録は受け付けていません。管理者からの招待が必要です。" };
  }

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
 * 成功時はlayoutキャッシュを破棄して next(既定 /app)にリダイレクトする。
 * 失敗時はエラーメッセージを返す(クライアント側で表示)。
 *
 * next の用途:
 *   招待リンクから /login?next=/invite/[token] に来たユーザーを、
 *   ログイン成功後に着地ページへ戻すため。検証は safeNextOr に任せ、
 *   外部 URL や scheme-relative は捨てて /app にフォールバックする
 *   (open redirect 対策)。
 */
export async function login(input: LoginInput, next?: string | null) {
  const supabase = await createClient();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for");
  const ua = hdrs.get("user-agent");

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    // ログイン失敗も記録(不正アクセス検知 / レート異常検知の起点)
    await recordAuditLog({
      userId: null,
      action: "login",
      metadata: { result: "failure", email: input.email, error: error.message },
      ipAddress: ip,
      userAgent: ua,
    });
    return { error: error.message };
  }

  // 成功時:user.id を取得して記録(法令対応・監査用)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await recordAuditLog({
      userId: user.id,
      action: "login",
      metadata: { result: "success", email: user.email ?? null },
      ipAddress: ip,
      userAgent: ua,
    });
  }

  revalidatePath("/", "layout");
  redirect(safeNextOr(next, "/app"));
}

/**
 * ログアウト Server Action
 */
export async function logout() {
  const supabase = await createClient();

  // signOut 前に user を取り、後で audit_log に残す
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for");
  const ua = hdrs.get("user-agent");

  await supabase.auth.signOut();

  if (user) {
    await recordAuditLog({
      userId: user.id,
      action: "logout",
      metadata: { email: user.email ?? null },
      ipAddress: ip,
      userAgent: ua,
    });
  }

  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * パスワード再設定リクエスト Server Action
 *
 * メールを忘れた / パスワードを忘れたユーザー向けの「リセットメール送信」アクション。
 *
 * redirectTo の組み立ては signup() の emailRedirectTo と同型:
 *   ${SITE_URL}/auth/callback?next=/reset-password
 * → メール内リンクをクリック → Supabase が /auth/callback?code=xxx に飛ばす
 * → callback が code をセッションに交換 → next で /reset-password に着地
 * → セッションが立った状態で updateUser({ password }) を呼べる。
 *
 * 【enumeration 対策・重要】
 *   未登録メールに対する挙動を「成功」と区別させないため、
 *   resetPasswordForEmail がエラーを返しても呼び出し側には常に { success: true } を返す。
 *   - 区別できると「このメールはこのサービスに登録済みか?」が当てられてしまう。
 *   - 内部的なエラーは console.error にエラーの種類だけ記録(メールアドレス値は出さない)。
 *   - レート制限など真の障害はサーバーログ側で監視する想定。
 */
export async function requestPasswordReset(email: string) {
  const supabase = await createClient();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent("/reset-password")}`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    // メール本文・アドレスは出さない。エラー種別のメタ情報だけ。
    console.error("[requestPasswordReset] resetPasswordForEmail failed", {
      name: error.name,
      status: error.status,
    });
  }

  // enumeration 対策のため、成否に関わらず success を返す。
  return { success: true as const };
}

/**
 * パスワード更新 Server Action(リセットフロー専用)
 *
 * リセットメールのリンクから callback 経由でセッションが立った状態で呼ばれる前提。
 * settings/password の「ログイン中の変更」と違い、現パスワードでの再認証は不要。
 * (ユーザーは現パスワードを忘れている)
 *
 * セッションが無い場合(リンク失効・直接アクセス等)は明示的にエラーを返し、
 * UI 側で再リクエスト導線を提示する。
 */
export async function updatePassword(newPassword: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "セッションが無効です。リンクをもう一度開いてください。",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    // 内部スキーマ名・SDK 文言をそのまま見せず、汎用文言にする。
    console.error("[updatePassword] updateUser failed", {
      name: error.name,
      status: error.status,
    });
    return {
      error: "パスワードの更新に失敗しました。お手数ですが再度お試しください。",
    };
  }

  return { success: true as const };
}
