import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { issuePwResetTicket } from "@/lib/auth/pw-reset-ticket";
import { safeNextOr } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * /auth/confirm
 *
 * メールリンク経由の認証(招待 / パスワードリセット / メール確認 / メアド変更)
 * を受け付けるエンドポイント。
 *
 * 経緯:
 *   ・/auth/callback の exchangeCodeForSession(code) は OAuth フロー専用で、
 *     受信者ブラウザに PKCE code_verifier クッキーが必要。
 *   ・メールリンクの受信者(別ブラウザ / 別端末でクリック)には code_verifier
 *     が無いため、招待 / リセットフローは一律に失敗していた。
 *   ・Supabase 公式 SSR ガイドどおり、メール系は token_hash を verifyOtp で
 *     検証する。code_verifier を必要としない。
 *
 * クエリ:
 *   ・token_hash : generateLink({type}) の properties.hashed_token
 *   ・type       : "invite" / "recovery" / "signup" / "magiclink" / "email_change"
 *   ・next       : 検証成功後の遷移先(safeNextOr で同一オリジン制限)
 *
 * 失敗時:
 *   /login?error=auth_callback_failed に統一(/auth/callback と揃える)。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextOr(searchParams.get("next"), "/app");

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const res = NextResponse.redirect(`${origin}${next}`);

  // H1 修正: type='recovery' / 'invite' で 認証 が 通った 場合 だけ、 短命 の
  // パスワード リセット チケット を 発行 する。 updatePassword server action は
  // この チケット を 必須 化 する ため、 通常 ログイン セッション だけ で は 現
  // パスワード なし の 変更 が できない よう に なる。
  //
  // invite を 含める 理由:
  //   組織 admin 招待 フロー は POST /api/admin/organizations で
  //   generateLink({type:"invite"}) → メール リンク → /auth/confirm?type=invite&
  //   next=/reset-password の 経路 で 動く。 recovery だけ を チケット 発行 対象
  //   に すると 招待 ユーザー は 初回 パスワード を 設定 できず 「有効期限が切れて
  //   います」 エラー に なる。 invite も 「メール 受信 = 本人 の 一発 証明」 と
  //   いう 点 で recovery と 同型 の セキュリティ 前提 な ので、 同じ チケット を
  //   発行 して 良い (むしろ しない と 招待 フロー が 完全 停止 する)。
  if (type === "recovery" || type === "invite") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const ticket = issuePwResetTicket(user.id);
      res.cookies.set(ticket.name, ticket.value, {
        maxAge: ticket.maxAge,
        httpOnly: ticket.httpOnly,
        secure: ticket.secure,
        sameSite: ticket.sameSite,
        path: ticket.path,
      });

      // ★MFA 端末 紛失 の lockout 対策 (セキュリティ 監査 MFA #3)。
      //   パスワード リセット を メール で 完遂 して いる = メール 所有 の 証明
      //   済み な の で、 MFA factor を 保持 して middleware で /login/mfa に
      //   戻し 続ける と 完全 lockout に なる。 recovery 経路 で は 全 factor を
      //   自動 解除 し、 パスワード 再設定 後 に 素の セッション で 通常 access できる
      //   状態 に する。 再度 MFA を 使いたい ユーザー は settings/security から
      //   再登録 する。
      //
      //   トレードオフ: メール 所有 = 攻撃者 も MFA を bypass できる 意味 に なるが、
      //   もともと パスワード reset で 100% access できる の で 実質 の 追加 攻撃 面
      //   は 無い。 「recovery コード」 を 別途 用意 する 案 は 将来 Phase で 検討。
      try {
        const { data: factorList } = await supabase.auth.mfa.listFactors();
        for (const f of factorList?.all ?? []) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      } catch (err) {
        // 一部 削除 失敗 は 握る (パスワード reset 自体 は 続行)。 監査 でも
        // recovery 経路 の factor 解除 失敗 は 通常 の アクセス 阻害 に は ならない
        // (残った factor が middleware で 引き続き gate に かける だけ)。
        console.warn("[auth/confirm] mfa factor clear failed during recovery", {
          user_id: user.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return res;
}
