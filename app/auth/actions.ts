"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SignupInput, LoginInput } from "@/lib/validations/auth";
import { signupSchema } from "@/lib/validations/auth";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { PW_RESET_TICKET_COOKIE, verifyPwResetTicket } from "@/lib/auth/pw-reset-ticket";
import { safeNextOr } from "@/lib/auth/safe-next";
import { getSiteUrl } from "@/lib/config/site-url";
import { isOpenSignupEnabled, isSoloSignupEnabled } from "@/lib/config/signup-mode";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";
import { sendSignupConfirmationEmail } from "@/lib/email/signup-confirmation";
import { consumeRateLimit } from "@/lib/rate-limit/rate-limit";

/**
 * x-forwarded-for は 「client, proxy1, proxy2」 の 順 で 並ぶ 慣例。 先頭 = 直接 の
 * client IP。 extractClientIp は Request オブジェクト を 引数 に 取る ので、
 * server action の string ヘッダ に は 別 の 抽出 関数 を 用意。
 *
 * x-forwarded-for が 無い 環境 (self-host / preview 等) は x-real-ip を fallback。
 * それ も 無ければ null を 返し、 呼出 側 で 「IP 判定 不可 = 保守的 に 弾く」 経路 に
 * 落とす (元 実装 で は "unknown" 文字列 を 一律 使って 全 攻撃者 が 同じ bucket
 * に なり、 legitimate な アクセス を 巻き添え に する 現象 が あった)。
 */
function extractLoginIp(
  xForwardedFor: string | null | undefined,
  xRealIp: string | null | undefined,
): string | null {
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = xRealIp?.trim();
  return real || null;
}

/**
 * 新規登録 Server Action
 *
 * 確認メールの リンクを token_hash + /auth/confirm(verifyOtp)方式で 送る。
 *
 * 経緯(2026-08-09 改定):
 *   ・旧実装は supabase.auth.signUp() + emailRedirectTo=/auth/callback だった。
 *     これは Supabase 内蔵メールで PKCE の ?code= リンクを送るため、確認リンクを
 *     登録時と別のブラウザ / 別端末 / メールアプリのアプリ内ブラウザで開くと
 *     code_verifier クッキーが無く exchangeCodeForSession が失敗していた
 *     (= 認証失敗)。内蔵メールは到達率も低い。
 *   ・パスワードリセット / Solo / 確認メール再送は既に generateLink + Resend +
 *     /auth/confirm(verifyOtp)方式に移行済みで別端末でも通る。本体 signup も
 *     同じ堅牢な方式に統一する。code_verifier 不要でデバイス間で動作する。
 *
 * 確認後の遷移先(next):
 *   ・メンバー招待  → /invite/[token](着地ページで accept_invitation ボタン)
 *   ・求職者招待 / 自由登録 → /app
 *     求職者招待は /auth/confirm 側で accept_client_invitation を email 一致で
 *     自動受諾する(token の受け渡しは不要)。
 *   ※ token 自体の検証は /invite/[token] 着地ページと RPC が信頼境界として行う。
 *     ここでは「リダイレクト先を組み立てる文字列」としてのみ扱う(上限 256 は
 *     signupSchema で担保)。
 */
export async function signup(input: SignupInput) {
  // BtoBtoC モード:招待トークン無しの自由登録は API レベルでも拒否する
  // (UI でガードしていても URL を直接叩く / 古いタブからの送信を防ぐ)
  // 受け付けるトークン:メンバー招待 or 求職者招待 のいずれか
  const hasAnyInvite = !!(input.invitationToken || input.clientInvitationToken);
  if (!hasAnyInvite && !isOpenSignupEnabled()) {
    return { error: "自由登録は受け付けていません。管理者からの招待が必要です。" };
  }

  // Server Action は直叩き可能なので、サーバー側でも入力を再検証する。
  // ・agreeToTerms(利用規約 / プライバシーポリシー同意・ADR 0006)を強制
  // ・email 形式 / パスワード長(bcrypt 72 バイト上限)を担保し、generateLink の
  //   不透明なエラーを分かりやすい文言に前倒しする。
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。" };
  }
  const { email: rawEmail, password, displayName, invitationToken } = parsed.data;
  const email = rawEmail.trim().toLowerCase();

  const siteUrl = getSiteUrl();

  // レート制限(reset / Solo と同型):IP 1 分 5 回 / email 1 時間 5 回。
  // 未認証 Server Action から generateLink + Resend を叩くため、無制限だと
  // メール砲で Resend クォータ枯渇 + ドメインレピュテーション毀損に繋がる。
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const [ipCheck, emailCheck] = await Promise.all([
    consumeRateLimit({ namespace: "signup:ip", identifier: ip, windowSeconds: 60, maxCount: 5 }),
    consumeRateLimit({
      namespace: "signup:email",
      identifier: email,
      windowSeconds: 3600,
      maxCount: 5,
      hashIdentifier: true,
    }),
  ]);
  if (ipCheck.limited || emailCheck.limited) {
    return { error: "試行が多すぎます。しばらく待ってから再度お試しください。" };
  }

  // メンバー招待だけ /invite/[token] に戻す。求職者招待 / 自由登録は /app。
  const next = invitationToken ? `/invite/${invitationToken}` : "/app";

  const admin = createServiceClient();

  // 既存ユーザー判定(getUserByEmail が admin API に無いため listUsers 走査)。
  // Solo / confirm_resend と同型。現状は 1 ページで完結、2000 人超で RPC 化する。
  let existing: { id: string; confirmed: boolean } | null = null;
  let reachedScanCap = true;
  for (let page = 1; page <= 40 && !existing; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) {
      reachedScanCap = false;
      break;
    }
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) {
      existing = { id: hit.id, confirmed: !!hit.email_confirmed_at };
      reachedScanCap = false;
      break;
    }
    if (data.users.length < 50) {
      reachedScanCap = false; // 最終ページまで見た(= 全件走査済み)
      break;
    }
  }
  if (!existing && reachedScanCap) {
    // 2000 人を走査しても見つからない = ユーザー増でスキャン上限に達した可能性。
    // cap 超過時は既存の未確認ユーザーを「新規」と誤判定し得る。その場合
    // generateLink(type:signup, password) が未確認アカウントのパスワードを上書きし、
    // 下の「パスワードを更新しない」乗っ取り対策が回避されるため、RPC 化の検知ログを残す。
    console.warn("[signup] listUsers scan hit cap without match (RPC lookup 化 を検討)");
  }

  try {
    let tokenHash: string | null = null;
    let otpType: "signup" | "magiclink" = "signup";

    if (!existing) {
      // 新規:signup 型で未確認ユーザーを作成し、表示名を metadata に保存。
      const { data, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: { display_name: displayName },
          redirectTo: `${siteUrl}/auth/confirm`,
        },
      });
      if (error || !data?.properties?.hashed_token) {
        console.error("[signup] generateLink(signup) failed", {
          name: error?.name,
          status: error?.status,
        });
        return { error: "登録に失敗しました。時間をおいて再度お試しください。" };
      }
      tokenHash = data.properties.hashed_token;
      otpType = "signup";
    } else if (existing.confirmed) {
      // 既に確認済み:enumeration 対策で、招待経由 / 自由登録どちらでも一律に成功を
      // 装って何も送らない(内蔵 signUp の従来挙動に合わせる)。
      // ※招待経由だけ「既に登録済み」と個別文言を返すと、ダミートークンを 1 個
      //   足すだけで「その email が確認済みユーザーか」を判別できる列挙オラクルに
      //   なるため出さない。登録済みユーザーは /invite/[token] 着地ページと
      //   ログイン導線で誘導する。
      return { success: true as const };
    } else {
      // 既存 未確認(再登録):magiclink で確認リンクを再送する。
      // ★パスワードは更新しない(セキュリティ)。未確認アカウントのパスワードを
      //   後続の呼出で差し替え可能にすると、攻撃者が被害者の未確認メール宛に自分の
      //   パスワードを仕込み → 被害者が確認リンクを踏む → 攻撃者がそのパスワードで
      //   ログイン、という乗っ取り経路が生じる。初回登録時のパスワードを保持する。
      //   表示名だけは最新に更新(shallow merge なので他 metadata は消えない)。
      await admin.auth.admin.updateUserById(existing.id, {
        user_metadata: { display_name: displayName },
      });
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${siteUrl}/auth/confirm` },
      });
      if (error || !data?.properties?.hashed_token) {
        console.error("[signup] generateLink(magiclink) failed", {
          name: error?.name,
          status: error?.status,
        });
        return { error: "確認メールの送信に失敗しました。時間をおいて再度お試しください。" };
      }
      tokenHash = data.properties.hashed_token;
      otpType = "magiclink";
    }

    const confirmUrl = new URL(`${siteUrl}/auth/confirm`);
    confirmUrl.searchParams.set("token_hash", tokenHash);
    confirmUrl.searchParams.set("type", otpType);
    confirmUrl.searchParams.set("next", next);

    const result = await sendSignupConfirmationEmail({
      toEmail: email,
      actionLink: confirmUrl.toString(),
    });
    if (!result.sent) {
      console.error("[signup] send failed", { reason: result.reason });
      return { error: "確認メールの送信に失敗しました。時間をおいて再度お試しください。" };
    }
  } catch (err) {
    console.error("[signup] unexpected", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { error: "登録処理でエラーが発生しました。時間をおいて再度お試しください。" };
  }

  return { success: true as const };
}

/**
 * 確認メール 再送 Server Action
 *
 * 背景:
 *   ・新規登録の確認メールは Supabase 内蔵メール(signUp)で PKCE の
 *     /auth/callback リンクとして送られるため、別端末 / アプリ内ブラウザで
 *     開くと code_verifier が無く失敗する。内蔵メールは到達率も低い。
 *   ・そこで「確認メールを再送」導線として、リセットと同じ generateLink +
 *     Resend + /auth/confirm(verifyOtp)方式のリンクを送る。別端末でも通る。
 *
 * type=magiclink を使う理由:
 *   ・既存の未確認ユーザーに対し、パスワード不要で確認リンクを生成できる
 *     (signup 型は password 必須で再送に使えない)。
 *   ・verifyOtp(type=magiclink)成功で email_confirmed_at がセットされ、
 *     そのままログイン状態で /app に着地する(dev 実機確認済み)。
 *
 * enumeration 対策:
 *   ・入力メールの登録有無に関わらず常に { success: true } を返す。
 *   ・実際に送るのは「存在 かつ 未確認」のユーザーだけ(確認済みユーザーに
 *     magic ログインリンクを送らない)。判定結果は呼び出し側に返さない。
 */
export async function resendConfirmationEmail(email: string) {
  const siteUrl = getSiteUrl();
  const normalizedEmail = email.trim().toLowerCase();

  // レート制限(reset と同型):IP 1 分 5 回 / email 1 時間 5 回。
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const [ipCheck, emailCheck] = await Promise.all([
    consumeRateLimit({
      namespace: "confirm_resend:ip",
      identifier: ip,
      windowSeconds: 60,
      maxCount: 5,
    }),
    consumeRateLimit({
      namespace: "confirm_resend:email",
      identifier: normalizedEmail,
      // 確認リンクは 実質 magic ログインリンク なので、リセット(3/時)と 同じ 厳しさに 揃える。
      windowSeconds: 3600,
      maxCount: 3,
      hashIdentifier: true,
    }),
  ]);
  if (ipCheck.limited || emailCheck.limited) {
    console.warn("[resendConfirmationEmail] rate limited", {
      ip_limited: ipCheck.limited,
      email_limited: emailCheck.limited,
    });
    return { success: true as const };
  }

  try {
    const admin = createServiceClient();

    // 「存在 かつ 未確認」ユーザーのみ対象。listUsers を走査して該当を探す。
    // (getUserByEmail が admin API に無いため。確認済み / 未登録には送らない)
    //
    // スケール注意:これは O(n) 走査(50/ページ、最大 40 ページ = 2000 人)。
    // 現状のユーザー数では 1 ページ目で完結する。将来 2000 人を超えたら、
    // auth.users を lower(email) で 索引引きする SECURITY DEFINER RPC に
    // 置き換えること(下の cap 到達 warning がその 検知トリガー)。
    let target: { id: string; confirmed: boolean } | null = null;
    let reachedScanCap = true;
    for (let page = 1; page <= 40 && !target; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
      if (error) {
        reachedScanCap = false;
        break;
      }
      const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === normalizedEmail);
      if (hit) {
        target = { id: hit.id, confirmed: !!hit.email_confirmed_at };
        reachedScanCap = false;
        break;
      }
      if (data.users.length < 50) {
        reachedScanCap = false; // 最終ページまで見た(= 全件走査済み)
        break;
      }
    }
    if (!target && reachedScanCap) {
      // 2000 人を走査しても見つからない = ユーザー増でスキャン上限に達した可能性。
      // 該当者が居ても再送されない silent 障害になる前に RPC 化するための検知ログ。
      console.warn(
        "[resendConfirmationEmail] listUsers scan hit cap without match (RPC lookup 化 を検討)",
      );
    }
    if (!target || target.confirmed) {
      // 未登録 or 確認済み:enumeration 対策で成功を装い、送信しない。
      return { success: true as const };
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: { redirectTo: `${siteUrl}/auth/confirm` },
    });
    if (error || !data?.properties?.hashed_token) {
      console.error("[resendConfirmationEmail] generateLink failed", {
        name: error?.name,
        status: error?.status,
      });
      return { success: true as const };
    }

    const confirmUrl = new URL(`${siteUrl}/auth/confirm`);
    confirmUrl.searchParams.set("token_hash", data.properties.hashed_token);
    confirmUrl.searchParams.set("type", "magiclink");
    confirmUrl.searchParams.set("next", "/app");

    const result = await sendSignupConfirmationEmail({
      toEmail: normalizedEmail,
      actionLink: confirmUrl.toString(),
    });
    if (!result.sent) {
      console.error("[resendConfirmationEmail] send failed", { reason: result.reason });
    }
  } catch (err) {
    console.error("[resendConfirmationEmail] unexpected", {
      name: err instanceof Error ? err.name : "unknown",
    });
  }

  return { success: true as const };
}

/**
 * Solo セルフサーブ サインアップ 開始 Server Action
 *
 * 背景:
 *   ・旧実装は client の supabase.auth.signUp で「即セッション」前提の楽観フロー
 *     だったが、メール確認必須の本番では session が返らず、確認後の org 作成も
 *     成立しなかった(確認リンクも PKCE で別端末に弱い)。
 *
 * 新フロー(手動で戻る手間なし):
 *   1. generateLink(type=signup) で未確認ユーザーを作成し、登録意図(plan / cycle /
 *      表示名)を user_metadata.pending_solo に保存(Supabase 内蔵メールは送らない)
 *   2. Resend で /auth/confirm?type=signup&next=/signup/solo/complete のリンクを送信
 *   3. 確認リンク(別端末OK)→ verifyOtp で確認+ログイン → /signup/solo/complete が
 *      metadata を読んで create-solo-account を呼び org+プラン作成 → Checkout / agency
 *
 * 既存ユーザー:
 *   ・確認済み → 通常ログインへ誘導(既存フォームと同じ UX。signup は enumeration より
 *     「登録済みなら知らせる」ほうが親切)
 *   ・未確認 → 意図を最新に更新し、magiclink で確認リンクを再送
 */
export async function startSoloSignup(input: {
  email: string;
  password: string;
  plan: "solo" | "solo_pro";
  cycle: "monthly" | "yearly";
  organizationName?: string;
}): Promise<{ error: string } | { needsConfirm: true }> {
  // ページの redirect と一致させ、API 直叩きでも Solo 未開放環境では弾く。
  if (!isSoloSignupEnabled()) {
    return { error: "Solo プランのセルフサーブ登録は現在受付を停止しています。" };
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "メールアドレスの形式が正しくありません。" };
  }
  if (input.password.length < 8) {
    return { error: "パスワードは8文字以上で入力してください。" };
  }
  // bcrypt の 72 バイト上限(signupSchema と 同じ)。超えると generateLink が
  // 不透明なエラーになるため、ここで 分かりやすい 文言に して 返す。
  if (input.password.length > 72) {
    return { error: "パスワードは72文字以内で入力してください。" };
  }
  const plan = input.plan === "solo_pro" ? "solo_pro" : "solo";
  const cycle = input.cycle === "yearly" ? "yearly" : "monthly";
  const orgName = input.organizationName?.trim().slice(0, 100) || null;
  const pendingSolo = { plan, cycle, org_name: orgName };

  const siteUrl = getSiteUrl();

  // レート制限(reset / 確認再送と同型):IP 1 分 5 回 / email 1 時間 5 回。
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const [ipCheck, emailCheck] = await Promise.all([
    consumeRateLimit({
      namespace: "solo_signup:ip",
      identifier: ip,
      windowSeconds: 60,
      maxCount: 5,
    }),
    consumeRateLimit({
      namespace: "solo_signup:email",
      identifier: email,
      windowSeconds: 3600,
      maxCount: 5,
      hashIdentifier: true,
    }),
  ]);
  if (ipCheck.limited || emailCheck.limited) {
    return { error: "試行が多すぎます。しばらく待ってから再度お試しください。" };
  }

  const admin = createServiceClient();

  // 既存ユーザー判定(getUserByEmail が admin API に無いため listUsers 走査)。
  // スケール注意:現状は 1 ページで完結。2000 人超で RPC 化する(confirm_resend と同じ)。
  let existing: { id: string; confirmed: boolean } | null = null;
  for (let page = 1; page <= 40 && !existing; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) break;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) existing = { id: hit.id, confirmed: !!hit.email_confirmed_at };
    if (data.users.length < 50) break;
  }

  try {
    let tokenHash: string | null = null;
    let otpType: "signup" | "magiclink" = "signup";

    if (!existing) {
      // 新規:signup 型で 作成 + 意図を metadata に 保存
      const { data, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password: input.password,
        options: { data: { pending_solo: pendingSolo }, redirectTo: `${siteUrl}/auth/confirm` },
      });
      if (error || !data?.properties?.hashed_token) {
        console.error("[startSoloSignup] generateLink(signup) failed", {
          name: error?.name,
          status: error?.status,
        });
        return { error: "登録に失敗しました。時間をおいて再度お試しください。" };
      }
      tokenHash = data.properties.hashed_token;
      otpType = "signup";
    } else if (existing.confirmed) {
      return { error: "このメールアドレスは既に登録済です。ログインしてからお進みください。" };
    } else {
      // 既存 未確認(再送):意図(plan / cycle / 表示名)だけ 最新に 更新 → magiclink で
      // 確認リンクを 再送する。
      // ★パスワードは あえて 更新しない(セキュリティ)。未確認アカウントの パスワードを
      //   後続の 呼出で 差し替え可能に すると、攻撃者が 被害者の 未確認メール宛に 自分の
      //   パスワードを 仕込み → 被害者が 確認リンクを 踏む → 攻撃者が その パスワードで
      //   ログイン、という 乗っ取り経路が 生じる。初回サインアップ時の パスワードを 保持する。
      //   (updateUserById の user_metadata は shallow merge なので display_name 等は 消えない)
      await admin.auth.admin.updateUserById(existing.id, {
        user_metadata: { pending_solo: pendingSolo },
      });
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${siteUrl}/auth/confirm` },
      });
      if (error || !data?.properties?.hashed_token) {
        console.error("[startSoloSignup] generateLink(magiclink) failed", {
          name: error?.name,
          status: error?.status,
        });
        return { error: "確認メールの再送に失敗しました。時間をおいて再度お試しください。" };
      }
      tokenHash = data.properties.hashed_token;
      otpType = "magiclink";
    }

    const confirmUrl = new URL(`${siteUrl}/auth/confirm`);
    confirmUrl.searchParams.set("token_hash", tokenHash);
    confirmUrl.searchParams.set("type", otpType);
    confirmUrl.searchParams.set("next", "/signup/solo/complete");

    const result = await sendSignupConfirmationEmail({
      toEmail: email,
      actionLink: confirmUrl.toString(),
    });
    if (!result.sent) {
      console.error("[startSoloSignup] send failed", { reason: result.reason });
      return { error: "確認メールの送信に失敗しました。時間をおいて再度お試しください。" };
    }
  } catch (err) {
    console.error("[startSoloSignup] unexpected", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { error: "登録処理でエラーが発生しました。時間をおいて再度お試しください。" };
  }

  return { needsConfirm: true };
}

/**
 * ログイン Server Action
 *
 * 成功時は redirect() せず遷移先(既定 /app)を返す。クライアントが window.location で
 * フルページ遷移して認証 Cookie を確実に載せる(Safari で Cookie が落ちる対策)。
 * 失敗時はエラーメッセージを返す(クライアント側で表示)。
 *
 * next の用途:
 *   招待リンクから /login?next=/invite/[token] に来たユーザーを、
 *   ログイン成功後に着地ページへ戻すため。検証は safeNextOr に任せ、
 *   外部 URL や scheme-relative は捨てて /app にフォールバックする
 *   (open redirect 対策)。
 */
type LoginActionResult = { error: string } | { ok: true; redirectTo: string };

export async function login(input: LoginInput, next?: string | null): Promise<LoginActionResult> {
  const supabase = await createClient();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for");
  const ua = hdrs.get("user-agent");
  const rlIp = extractLoginIp(ip, hdrs.get("x-real-ip"));

  // ── credential stuffing 対策: IP と email の 2 段 で rate limit。
  //     ・IP: 60 秒 に 10 回 (誤入力 の 現実 的 上限 と 攻撃 の 差 を つける)
  //     ・email: 15 分 に 20 回 (辞書 攻撃 で 特定 アカウント を 狙い撃つ 経路)
  //     どちら か が 超過 したら 429 相当 を 返す。 監査ログ は 「rate_limited」 で 記録。
  //
  //     ★email は 大文字小文字 の 差 で bucket が 分離 する と case rotate で
  //       bypass される (セキュリティ 監査 #1)。 lowercase に 正規化 して 1 bucket に 集約。
  //     ★IP が 取れ ない (rlIp=null) は identify 不能 な の で IP bucket は skip し、
  //       email bucket のみ で 判定 する (旧 実装 は "unknown" で 全員 巻き 添え)。
  const normalizedEmail = input.email.trim().toLowerCase();
  const rateLimitChecks: Array<Promise<{ limited: boolean }>> = [
    consumeRateLimit({
      namespace: "auth:login:email",
      identifier: normalizedEmail,
      windowSeconds: 15 * 60,
      maxCount: 20,
      hashIdentifier: true,
    }),
  ];
  if (rlIp !== null) {
    rateLimitChecks.unshift(
      consumeRateLimit({
        namespace: "auth:login:ip",
        identifier: rlIp,
        windowSeconds: 60,
        maxCount: 10,
      }),
    );
  }
  const results = await Promise.all(rateLimitChecks);
  const ipLimited = rlIp !== null ? results[0].limited : false;
  const emailLimited = rlIp !== null ? results[1].limited : results[0].limited;
  if (ipLimited || emailLimited) {
    await recordAuditLog({
      userId: null,
      action: "login",
      metadata: {
        result: "rate_limited",
        email: input.email,
        by: ipLimited && emailLimited ? "ip+email" : ipLimited ? "ip" : "email",
      },
      ipAddress: ip,
      userAgent: ua,
    });
    return {
      error: "ログイン試行が多すぎます。しばらく時間をおいてから再度お試しください。",
    };
  }

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
  // Safari 対策: Server Action 内で redirect() すると、直前に set した認証 Cookie が
  // RSC ナビゲーションで確実に反映されず、ログイン成功後に /login へ戻される
  // (Chrome は反映されるが Safari は Cookie が落ちる)。遷移先を返し、クライアント側で
  // window.location のフルページ遷移をして Cookie を確実に載せる。
  return { ok: true as const, redirectTo: safeNextOr(next, "/app") };
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

  // H3 修正: IP × email 複合 キー の sliding window レート 制限。
  // 未認証 Server Action で generateLink + Resend 送信 を 呼び出す ため、
  // 制限 が 無い と メール 砲 で Resend クォータ 枯渇 + ドメイン レピュテーション
  // 崩壊 が 発生 する。 IP: 1 分 5 回、 email: 1 時間 3 回。
  // 上限 超過 で も enumeration 対策 の ため success を 返す (メール は 送ら ない)。
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const [ipCheck, emailCheck] = await Promise.all([
    consumeRateLimit({
      namespace: "pw_reset:ip",
      identifier: ip,
      windowSeconds: 60,
      maxCount: 5,
    }),
    consumeRateLimit({
      namespace: "pw_reset:email",
      identifier: email.toLowerCase(),
      windowSeconds: 3600,
      maxCount: 3,
      hashIdentifier: true,
    }),
  ]);
  if (ipCheck.limited || emailCheck.limited) {
    console.warn("[requestPasswordReset] rate limited", {
      ip_limited: ipCheck.limited,
      email_limited: emailCheck.limited,
    });
    return { success: true as const };
  }

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

  // H1 修正: recovery / invite セッション 経由 かどうか を チケット cookie で 検証。
  // 通常 ログイン セッション で /reset-password に 直行 する セッション 乗っ取り 経路 を 塞ぐ。
  //
  // エラー 文言 に は 「セッション」 の 語 を 含める こと。 reset-password-form.tsx
  // の 分岐 が この キーワード を 検出 して、 綺麗 な 「パスワード再設定をやり直す」
  // 誘導 UI に 切り替える。
  const cookieStore = await cookies();
  const ticket = cookieStore.get(PW_RESET_TICKET_COOKIE)?.value;
  if (!verifyPwResetTicket(ticket, user.id)) {
    return {
      error:
        "パスワード変更のセッションが無効です。リンクの有効期限が切れているため、再度メールリンクを開き直してください。",
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
