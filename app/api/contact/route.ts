import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContactNotificationEmail } from "@/lib/email/contact";

/**
 * LP 問い合わせフォーム送信 API
 *
 * 認証は不要(公開エンドポイント)。
 * Resend で運営宛て通知メールを送る。DB 保存はしない(今回は通知のみ)。
 *
 * セキュリティ方針:
 * - zod で入力サイズと形式を検証し、長すぎる本文や不正メールを 400 で弾く。
 * - スパム対策として IP 単位の簡易レート制限を入れる(プロセス内メモリ)。
 *   サーバーレス環境ではインスタンスが分散するので完璧ではないが、
 *   素朴な連投を防ぐ程度の保険として置く。
 * - エラー時は内部詳細(キー未設定/Resend エラー本文等)を握りつぶし、
 *   汎用メッセージのみ返す。詳細はサーバーログにのみ出す(秘密値はログにも出さない)。
 * - メールはプレーンテキストにすることで XSS/HTML インジェクションを根本回避。
 */

// クライアント側 zod と同一の制約。サーバー側でも必ず検証する(クライアントは信頼しない)。
const contactSchema = z.object({
  company: z.string().min(1).max(100),
  name: z.string().min(1).max(50),
  email: z.string().email().max(254), // RFC 5321 のメールアドレス最大長
  message: z.string().min(10).max(2000),
});

// IP 単位の簡易レート制限(モジュールスコープのメモリ)。
// Vercel サーバーレスは同一インスタンスが暫く再利用されるので、最小限の連投抑止には機能する。
const RATE_LIMIT_WINDOW_MS = 60_000; // 60秒
const RATE_LIMIT_MAX = 3; // 60秒に3通まで
const rateLimitBuckets = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const history = (rateLimitBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (history.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(ip, history);
    return false;
  }
  history.push(now);
  rateLimitBuckets.set(ip, history);
  return true;
}

function getClientIp(request: Request): string {
  // Vercel/Cloudflare 経由の場合は x-forwarded-for に元 IP が入る。
  // 直接アクセス時(開発環境)は unknown でも構わない。
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  // 1) レート制限
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: "送信回数が多すぎます。時間をおいて再度お試しください。" },
      { status: 429 },
    );
  }

  // 2) 入力パース & バリデーション
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "リクエスト形式が不正です。" }, { status: 400 });
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "入力内容に誤りがあります。" }, { status: 400 });
  }

  // 3) Resend で通知メール送信
  const result = await sendContactNotificationEmail(parsed.data);

  if (!result.sent) {
    // 失敗詳細はサーバーログにのみ出す(秘密値や HTTP 本文を含む可能性があるためレスポンスには含めない)。
    if (result.reason === "not_configured") {
      console.error(
        "[api/contact] メール送信失敗:Resend 関連の環境変数が未設定です " +
          "(RESEND_API_KEY / CONTACT_NOTIFICATION_TO / CONTACT_NOTIFICATION_FROM)",
      );
    } else {
      console.error("[api/contact] メール送信失敗:", result.error ?? "(no error detail)");
    }
    return NextResponse.json(
      { ok: false, error: "送信に失敗しました。時間をおいて再度お試しください。" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
