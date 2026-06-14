/**
 * Resend HTTP API ラッパー(Deno)
 *
 * Web 側 `lib/email/invitation.ts` と同じ「SDK を使わず HTTP 直叩き」パターン。
 * 依存追加を避けるため fetch のみで実装。
 *
 * RESEND_API_KEY / EMAIL_FROM が未設定なら no-op で `{sent: false, reason: 'not_configured'}` を返す。
 * 呼び出し側はその場合 ma_send_logs に status='skipped' で記録する。
 */

export type SendResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendArgs = {
  toEmail: string;
  subject: string;
  body: string; // プレーンテキスト本文。HTML は使わない(XSS リスク回避、既存パターン踏襲)
  replyTo?: string; // 担当アドバイザーのメアドを入れると、返信が担当者に届く
  tags?: { name: string; value: string }[];
};

export async function sendViaResend(args: SendArgs): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");

  if (!apiKey || !from) {
    // 設定不足は「失敗」ではなく「スキップ」扱い。ログには status='skipped' で記録する。
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
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        ...(args.tags ? { tags: args.tags } : {}),
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
