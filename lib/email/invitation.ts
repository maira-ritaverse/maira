/**
 * 招待メール送信(Resend)
 *
 * 現状 RESEND_API_KEY と EMAIL_FROM のどちらか未設定なら送信せず、
 * 「未設定で skip した」ことだけを呼び出し側に返す。
 *
 * 後で Resend を有効化したら .env.local に追加するだけで動くように、
 * 環境変数の有無で no-op するだけのシンプルな実装にしてある。
 * SDK を入れずに HTTP API を直接叩く形(依存追加を避けるため)。
 */

export type SendInvitationResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendInvitationArgs = {
  toEmail: string;
  organizationName: string;
  inviteUrl: string;
  expiresAt: Date;
};

export async function sendInvitationEmail(args: SendInvitationArgs): Promise<SendInvitationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    // 未設定で送信しない。呼び出し側で「リンクを手動で渡してください」UI を出す。
    return { sent: false, reason: "not_configured" };
  }

  const expiresLabel = args.expiresAt.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const subject = `${args.organizationName} からの招待`;
  const text =
    `${args.organizationName} のエージェント管理画面に招待されました。\n\n` +
    `下記のリンクから 7 日以内に参加してください(有効期限:${expiresLabel})。\n\n` +
    `${args.inviteUrl}\n\n` +
    `※このメールに心当たりが無い場合は破棄してください。`;

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
