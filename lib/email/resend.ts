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

/**
 * Resend でメールを送る。
 *
 * apiKey / from はどちらもオプション。未指定なら Maira の env に fallback する
 * (BYO 案 B:各組織が自分の Resend アカウントを持ち込むケースでは、
 *  呼び出し側で組織の DB 設定を復号して渡す)。
 */
export async function sendViaResend(args: {
  toEmail: string;
  subject: string;
  body: string;
  /** タグ(Resend の集計 / 検索用)。 未指定なら送らない。 */
  tags?: Array<{ name: string; value: string }>;
  /** org 単位で持ち込まれた Resend API キー。 未指定は env にフォールバック。 */
  apiKey?: string | null;
  /** org 単位で設定された送信元。 未指定は env EMAIL_FROM にフォールバック。 */
  from?: string | null;
}): Promise<ResendSendResult> {
  const apiKey = args.apiKey ?? process.env.RESEND_API_KEY;
  const from = args.from ?? process.env.EMAIL_FROM;

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

/**
 * 送信先の API キーが「テストキー」で始まっているかで軽く形式を確認する。
 * Resend の API キーは 're_' プレフィックス。 UI 側の入力ミスを早期に弾く。
 */
export function looksLikeResendKey(value: string): boolean {
  return /^re_[A-Za-z0-9_-]{10,}$/.test(value.trim());
}
