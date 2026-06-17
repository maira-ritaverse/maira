/**
 * Vercel Cron からの呼び出しを認証する共通ヘルパー。
 *
 * Vercel の仕様:
 *   ・CRON_SECRET 環境変数が設定されていると、cron 起動時に
 *     `Authorization: Bearer <CRON_SECRET>` を自動付与する
 *   ・未設定の場合は無認証で叩かれる
 *
 * Maira の従来仕様:
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
    if (vercelSecret && token === vercelSecret) return { ok: true };
    if (intakeSecret && token === intakeSecret) return { ok: true };
  }

  // X-Cron-Secret: <token>(手動 trigger 用の互換ヘッダ)
  if (xCron) {
    if (intakeSecret && xCron === intakeSecret) return { ok: true };
    if (vercelSecret && xCron === vercelSecret) return { ok: true };
  }

  return { ok: false, reason: "unauthorized" };
}
