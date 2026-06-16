import { recordAuditLog } from "@/lib/audit/audit-log";
import { requireUser } from "@/lib/api/auth-guards";
import { buildAccountExport } from "@/lib/account/export";

/**
 * GET /api/account/export
 *
 * 本人のアカウントデータを JSON として返す(個人情報保護法 第33条 開示請求対応)。
 *
 * - 認証必須(本人のみ)
 * - レスポンスは Content-Disposition: attachment で JSON ファイル化
 * - 監査ログに data_exported を記録(法令上「開示した」事実を残す)
 *
 * 注意:
 *   - 復号後の平文を返すためレスポンスサイズは大きくなり得る
 *   - 履歴書写真などのバイナリは含まない(別途ストレージから取得)
 */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const payload = await buildAccountExport({
    userId: user.id,
    email: user.email ?? null,
  });

  await recordAuditLog({
    userId: user.id,
    action: "data_exported",
    metadata: { email: user.email ?? null },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `maira-export-${today}.json`;
  const json = JSON.stringify(payload, null, 2);

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// 復号 + 集約に時間がかかり得るのでタイムアウトを延長
export const maxDuration = 60;
