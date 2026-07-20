import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { requireUser } from "@/lib/api/auth-guards";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/clients/[id]/reveal-notes
 *
 * 運営者用: client_records の 暗号化 内部 メモ を 復号 して 返す。
 *
 * 暗号化 対象 は 「業務 上 の 内部 メモ」 (推薦文 / 面談メモ / ステータス メモ /
 * 転職理由 / 希望条件 詳細 / 学歴 詳細 / スキル / 他社 利用 状況 / 連絡方法
 * の 希望) で、 サーバー サイド AES-256-GCM で 保護 されて いる。 admin は
 * service_role の 環境 変数 経由 で 復号 可能 だが、 「運営者 による アクセス
 * は 保管 / AI 処理 / 法令対応 に 限定」 の ポリシー に 対する 例外 (トラブル
 * 対応 / サポート 依頼 / 監査) として 明示的 に 露出 する 経路 を 分ける。
 *
 * 呼出 する と 必ず audit ログ (admin_accessed_user, event_subtype=
 * admin_revealed_client_encrypted_notes) を 記録 する。 誰 が いつ どの
 * client_record を どんな 理由 で 開いた か を 後 から 追える ように する。
 *
 * リクエスト Body: { reason?: string } (任意、 audit ログ に 残す)
 *
 * 認可: isMairaAdmin ガード。
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user: actor } = guard;

  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // reason は 任意。 空 でも OK。
  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason.trim().length > 0) {
      reason = body.reason.trim().slice(0, 500);
    }
  } catch {
    // body なし で も 復号 は 通す
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("client_records")
    .select(
      "id, organization_id, encrypted_recommendation_comment, encrypted_other_agency_status, encrypted_contact_method_preference, encrypted_education_detail, encrypted_skills, encrypted_job_change_reason, encrypted_desired_conditions, encrypted_meeting_notes, encrypted_status_memo",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const row = data as Record<string, string | null>;

  // ── ★ 監査 ログ を 「復号 の 前」 に 書く (strict=true で 失敗 時 500)。
  //     ・decryptField が throw して も 「アクセス した 事実」 は 残る (法的 追跡 の 前提)
  //     ・audit INSERT 自体 が 失敗 する ケース (RLS drift 等) は fail-hard で
  //       復号 レスポンス を 返さ ない ように する (コンプライアンス 保護)
  //     ・従来 は decryptField 後 に audit を 書いて いた の で、 復号 例外 で audit
  //       が スキップ される 穴 が あった
  try {
    await recordAuditLog({
      userId: actor.id,
      action: "admin_accessed_user",
      metadata: {
        event_subtype: "admin_revealed_client_encrypted_notes",
        client_record_id: row.id,
        organization_id: row.organization_id,
        reason,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      strict: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "audit_failed",
        message:
          err instanceof Error
            ? `監査ログの記録に失敗したため復号を中止しました: ${err.message}`
            : "監査ログの記録に失敗したため復号を中止しました",
      },
      { status: 500 },
    );
  }

  // 復号 は 並列。 各 フィールド は 独立 な の で await Promise.all で 1 ラウンド。
  const [
    recommendationComment,
    otherAgencyStatus,
    contactMethodPreference,
    educationDetail,
    skills,
    jobChangeReason,
    desiredConditions,
    meetingNotes,
    statusMemo,
  ] = await Promise.all([
    decryptField(row.encrypted_recommendation_comment ?? null),
    decryptField(row.encrypted_other_agency_status ?? null),
    decryptField(row.encrypted_contact_method_preference ?? null),
    decryptField(row.encrypted_education_detail ?? null),
    decryptField(row.encrypted_skills ?? null),
    decryptField(row.encrypted_job_change_reason ?? null),
    decryptField(row.encrypted_desired_conditions ?? null),
    decryptField(row.encrypted_meeting_notes ?? null),
    decryptField(row.encrypted_status_memo ?? null),
  ]);

  return NextResponse.json({
    recommendationComment: recommendationComment ?? null,
    otherAgencyStatus: otherAgencyStatus ?? null,
    contactMethodPreference: contactMethodPreference ?? null,
    educationDetail: educationDetail ?? null,
    skills: skills ?? null,
    jobChangeReason: jobChangeReason ?? null,
    desiredConditions: desiredConditions ?? null,
    meetingNotes: meetingNotes ?? null,
    statusMemo: statusMemo ?? null,
  });
}
