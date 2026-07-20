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

  // ── 監査 ログ (成功 側 で 記録。 失敗 (decrypt error) は throw で 500 に なる)
  //     audit テーブル の action enum を 拡張 する のは 影響 が 広い の で、
  //     既存 admin_accessed_user を 流用 + event_subtype で 種別 分け する
  //     (組織 archive 等 と 同じ パターン)。
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
  });

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
