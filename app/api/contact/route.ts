import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContactNotificationEmail } from "@/lib/email/contact";
import { consumeRateLimit, extractClientIp } from "@/lib/rate-limit/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

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

export async function POST(request: Request) {
  // M5 修正: モジュール スコープ の Map は Vercel の lambda スケール アウト で
  // インスタンス 間 の 状態 共有 が でき ず、 100 並列 POST で 実質 バイパス
  // される。 Supabase テーブル に イベント を 記録 する sliding window 方式 に 移行。
  const ip = extractClientIp(request);
  const rate = await consumeRateLimit({
    namespace: "contact:ip",
    identifier: ip,
    windowSeconds: 60,
    maxCount: 3,
  });
  if (rate.limited) {
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

  // 3) DB に保存(運営者の受信箱に履歴として残す)
  //    メール送信が失敗してもデータは残るので、運営者は後から拾える。
  //    service_role を使うのは anon に INSERT 権限を与えないため。
  try {
    const admin = createServiceClient();
    await admin.from("contact_messages").insert({
      company: parsed.data.company,
      name: parsed.data.name,
      email: parsed.data.email,
      message: parsed.data.message,
      ip_address: ip === "unknown" ? null : ip,
      user_agent: request.headers.get("user-agent"),
    });
  } catch (err) {
    // 保存失敗は致命的でないのでログだけ吐いて続行(メール送信は試みる)
    console.error("[api/contact] contact_messages の保存に失敗:", err);
  }

  // 4) Resend で通知メール送信
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
