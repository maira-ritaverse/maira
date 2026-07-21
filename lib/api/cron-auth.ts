import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron からの呼び出しを認証する共通ヘルパー。
 *
 * Vercel の仕様:
 *   ・CRON_SECRET 環境変数が設定されていると、cron 起動時に
 *     `Authorization: Bearer <CRON_SECRET>` を自動付与する
 *   ・未設定の場合は無認証で叩かれる
 *
 * Myaira の従来仕様:
 *   ・INTAKE_CRON_SECRET を独自に持ち、外部からの手動 trigger でも
 *     使えるようにしていた(Authorization: Bearer / x-cron-secret)
 *
 * 両方をシームレスにサポート:
 *   ・Vercel cron 由来は CRON_SECRET で通る
 *   ・手動 trigger / GitHub Actions 等の外部は INTAKE_CRON_SECRET でも通る
 *
 * いずれの env も未設定なら認証不能(本番障害の早期検知のため `enabled=false` を返す)。
 */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "unauthorized" };

export function checkCronAuth(request: Request): CronAuthResult {
  const vercelSecret = process.env.CRON_SECRET?.trim() || null;
  const intakeSecret = process.env.INTAKE_CRON_SECRET?.trim() || null;

  // どちらも未設定なら 503 相当(運用上の設定ミス)
  if (!vercelSecret && !intakeSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const auth = request.headers.get("authorization");
  const xCron = request.headers.get("x-cron-secret");

  // Authorization: Bearer <token>
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (vercelSecret && safeEqual(token, vercelSecret)) return { ok: true };
    if (intakeSecret && safeEqual(token, intakeSecret)) return { ok: true };
  }

  // X-Cron-Secret: <token>(手動 trigger 用の互換ヘッダ)
  if (xCron) {
    if (intakeSecret && safeEqual(xCron, intakeSecret)) return { ok: true };
    if (vercelSecret && safeEqual(xCron, vercelSecret)) return { ok: true };
  }

  return { ok: false, reason: "unauthorized" };
}

/**
 * 定数時間 の 文字列 比較。 `===` は 先頭 から の 一致 で 早期 return する ため、
 * 極端 な リモート 環境 で は タイミング attack で 秘密 を 復元 できる。
 * timingSafeEqual は 長さ が 異なる と throw する ので、 長さ 事前 チェック が 必須。
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
