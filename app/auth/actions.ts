"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SignupInput, LoginInput } from "@/lib/validations/auth";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { PW_RESET_TICKET_COOKIE, verifyPwResetTicket } from "@/lib/auth/pw-reset-ticket";
import { safeNextOr } from "@/lib/auth/safe-next";
import { getSiteUrl } from "@/lib/config/site-url";
import { isOpenSignupEnabled } from "@/lib/config/signup-mode";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";

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
  // 受け付けるトークン:メンバー招待 or 求職者招待 のいずれか
  const hasAnyInvite = !!(input.invitationToken || input.clientInvitationToken);
  if (!hasAnyInvite && !isOpenSignupEnabled()) {
    return { error: "自由登録は受け付けていません。管理者からの招待が必要です。" };
  }

  const supabase = await createClient();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const callbackBase = `${siteUrl}/auth/callback`;
  // メンバー招待は /invite/[token] 着地で accept_invitation RPC を呼ぶフロー、
  // 求職者招待は callback で accept_client_invitation RPC を呼ぶフローなので、
  // 求職者招待では next は付けない(/app に戻して終わり)。
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
 * 設計判断(2026-06-17 改定):
 *   ・以前は supabase.auth.resetPasswordForEmail() + Supabase 標準テンプレートに
 *     依存していたが、受信者が別ブラウザ / 別端末でリンクを開いた際に PKCE の
 *     code_verifier クッキーが無く exchangeCodeForSession が失敗していた。
 *   ・generateLink({type:'recovery'}) で hashed_token を取得し、独自エンドポイント
 *     /auth/confirm で verifyOtp({type,token_hash}) する形に切り替える。
 *     code_verifier 不要のためデバイス間で動作する。
 *   ・メール本文も日本語 HTML に統一(他メールと layout 共有)。
 *
 * 【enumeration 対策・重要】
 *   未登録メールに対する挙動を「成功」と区別させないため、
 *   generateLink がエラーを返してもメール送信失敗でも、呼び出し側には常に
 *   { success: true } を返す。エラーは console.error に種別だけ。
 */
export async function requestPasswordReset(email: string) {
  const siteUrl = getSiteUrl();

  try {
    // generateLink は service_role が必須。anon クライアントでは呼べない。
    const admin = createServiceClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        // generateLink の redirectTo は本来 action_link 末尾に付くものだが、
        // 自前の /auth/confirm を URL として組み直すため使わない。
        // ただし「Supabase の Site URL 設定」検証で参照されるため安全側で渡す。
        redirectTo: `${siteUrl}/auth/confirm`,
      },
    });

    if (error || !data?.properties?.hashed_token) {
      // メール本文・アドレスは出さない。エラー種別のメタ情報だけ。
      // user_not_found の error が来た場合もここで握りつぶす(enumeration 対策)。
      console.error("[requestPasswordReset] generateLink failed", {
        name: error?.name,
        status: error?.status,
      });
      return { success: true as const };
    }

    // /auth/confirm に渡す URL を組み立て
    const confirmUrl = new URL(`${siteUrl}/auth/confirm`);
    confirmUrl.searchParams.set("token_hash", data.properties.hashed_token);
    confirmUrl.searchParams.set("type", "recovery");
    confirmUrl.searchParams.set("next", "/reset-password");

    const result = await sendPasswordResetEmail({
      toEmail: email,
      actionLink: confirmUrl.toString(),
    });
    if (!result.sent) {
      console.error("[requestPasswordReset] sendPasswordResetEmail failed", {
        reason: result.reason,
      });
    }
  } catch (err) {
    console.error("[requestPasswordReset] unexpected", {
      name: err instanceof Error ? err.name : "unknown",
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

  // H1 修正: recovery セッション 経由 かどうか を チケット cookie で 検証。
  // 通常 ログイン セッション で /reset-password に 直行 する セッション 乗っ取り 経路 を 塞ぐ。
  const cookieStore = await cookies();
  const ticket = cookieStore.get(PW_RESET_TICKET_COOKIE)?.value;
  if (!verifyPwResetTicket(ticket, user.id)) {
    return {
      error:
        "パスワード変更 の 有効 期限 が 切れて い ます。 /forgot-password から やり 直し てください。",
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

  // 監査 ログ (M1) + チケット の 使い 切り 削除
  await recordAuditLog({
    userId: user.id,
    action: "password_changed",
    metadata: { flow: "reset" },
  });
  cookieStore.delete(PW_RESET_TICKET_COOKIE);

  return { success: true as const };
}
