/**
 * 招待メール送信(Resend)
 *
 * 招待された人が迷わず登録できるよう、メール本文に
 *   ・初めて Maira を使う場合 → 新規登録(パスワード設定)リンク
 *   ・すでに Maira アカウントがある場合 → ログインリンク
 * の 2 本立てで案内する。
 *
 * RESEND_API_KEY と EMAIL_FROM のどちらか未設定なら no-op で返す
 * (呼び出し側で「リンクを手動で渡してください」UI を出す)。
 */

export type SendInvitationResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendInvitationArgs = {
  toEmail: string;
  organizationName: string;
  /** /invite/[token] のフル URL(着地ページ) */
  inviteUrl: string;
  /** 招待トークン(/signup?invitationToken=... の URL を組むのに使う) */
  token: string;
  /** サイトのベース URL(NEXT_PUBLIC_SITE_URL)。signup / login の URL 組み立てに使う */
  siteUrl: string;
  expiresAt: Date;
};

export async function sendInvitationEmail(args: SendInvitationArgs): Promise<SendInvitationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const expiresLabel = args.expiresAt.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const base = args.siteUrl.replace(/\/$/, "");
  const signupUrl = `${base}/signup?invitationToken=${encodeURIComponent(args.token)}`;
  const loginUrl = `${base}/login?next=${encodeURIComponent(`/invite/${args.token}`)}`;

  const subject = `【Maira】${args.organizationName} からの招待が届いています`;

  const text = [
    `${args.organizationName} のエージェント管理画面に招待されました。`,
    ``,
    `有効期限:${expiresLabel}(7 日以内に手続きをお願いします)`,
    ``,
    `━━━ 初めて Maira を使う方 ━━━`,
    `下記のリンクから新規登録 + パスワード設定をしてください。`,
    `${signupUrl}`,
    ``,
    `━━━ すでに Maira アカウントをお持ちの方 ━━━`,
    `下記のリンクからログイン後、招待を受け入れてください。`,
    `${loginUrl}`,
    ``,
    `※招待されたメールアドレス(${args.toEmail})でご登録 / ログインしてください。`,
    `※このメールに心当たりが無い場合は破棄してください。`,
    ``,
    `──────────`,
    `Maira(マイラ)`,
    `https://maira.pro`,
  ].join("\n");

  // HTML 版(ボタン表示で見やすく)
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(args.organizationName)} からの招待</h2>
  <p style="margin:0 0 16px;color:#444;">
    ${escapeHtml(args.organizationName)} のエージェント管理画面に招待されました。<br>
    <span style="color:#888;font-size:14px;">有効期限:${escapeHtml(expiresLabel)}(7 日以内)</span>
  </p>

  <div style="margin:24px 0;padding:16px;background:#f6f7f9;border-radius:8px;">
    <p style="margin:0 0 8px;font-weight:600;">初めて Maira を使う方</p>
    <p style="margin:0 0 12px;font-size:14px;color:#555;">
      下記のボタンから新規登録 + パスワード設定をしてください。
    </p>
    <a href="${signupUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
      新規登録してパスワードを設定する
    </a>
  </div>

  <div style="margin:24px 0;padding:16px;background:#f6f7f9;border-radius:8px;">
    <p style="margin:0 0 8px;font-weight:600;">すでに Maira アカウントをお持ちの方</p>
    <p style="margin:0 0 12px;font-size:14px;color:#555;">
      下記のボタンからログイン後、招待を受け入れてください。
    </p>
    <a href="${loginUrl}" style="display:inline-block;padding:10px 20px;background:#fff;color:#111;text-decoration:none;border:1px solid #d0d0d0;border-radius:6px;font-weight:600;">
      ログインする
    </a>
  </div>

  <p style="margin:24px 0 0;font-size:12px;color:#888;">
    ※招待されたメールアドレス(<strong>${escapeHtml(args.toEmail)}</strong>)でご登録 / ログインしてください。<br>
    ※このメールに心当たりが無い場合は破棄してください。
  </p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #e6e6e6;">
  <p style="margin:0;font-size:12px;color:#888;">
    Maira(マイラ)<br>
    <a href="https://maira.pro" style="color:#666;">https://maira.pro</a>
  </p>
</div>
`.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.toEmail],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: "send_failed", error: `HTTP ${res.status}: ${body}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, messageId: data.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
