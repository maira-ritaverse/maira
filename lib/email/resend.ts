/**
 * Resend HTTP API 直叩きの共通ラッパー。
 *
 * これまで test-send.ts / meetings/notify.ts / email/invitation.ts などが
 * 個別に fetch していたのを、Flow ビルダーの email チャネルも同じ道筋で
 * 送れるようにするため関数化する。
 *
 * 呼び出し側は「送れたか / 理由」を判定できる構造化された結果を受け取る。
 * Resend の環境変数(RESEND_API_KEY / EMAIL_FROM)が未設定の場合は
 * not_configured を返し、呼び出し側は skipped 扱いにする。
 */

export type ResendSendResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" }
  | { sent: false; reason: "send_failed"; error: string };

export async function sendViaResend(args: {
  toEmail: string;
  subject: string;
  body: string;
  /** タグ(Resend の集計 / 検索用)。 未指定なら送らない。 */
  tags?: Array<{ name: string; value: string }>;
}): Promise<ResendSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

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
        subject: args.subject,
        text: args.body,
        ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        sent: false,
        reason: "send_failed",
        error: `HTTP ${res.status}: ${body.slice(0, 500)}`,
      };
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

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
