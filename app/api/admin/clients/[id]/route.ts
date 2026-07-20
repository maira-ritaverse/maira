import { NextResponse } from "next/server";

import { getAuthUsersByIds } from "@/lib/admin/auth-users";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/clients/[id]
 *
 * 運営者用: 求職者 (client_records) 1 件 の 基本 プロフィール を 返す。
 *
 * 返さ ない もの:
 *   ・暗号化 フィールド (推薦文 / 面談メモ / ステータス メモ / 転職理由 /
 *     希望条件 詳細 / 学歴 詳細 / スキル / 他社 利用 状況 / 連絡方法 の 希望)。
 *     これら は POST /api/admin/clients/[id]/reveal-notes で 明示的 に 復号
 *     経路 を 通し、 audit ログ を 残す。
 *   ・「他社 利用 状況 有無 の flag」 だけ は 一覧 用 に 平文 で 出す (encrypted
 *     フィールド の null 判定 で 導出)。
 *
 * 認可: isMairaAdmin ガード。
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createServiceClient();

  const { data, error } = await admin.from("client_records").select("*").eq("id", id).maybeSingle();
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const row = data as Record<string, unknown>;

  // 組織 名 と 担当 CA / 起票者 メール も 一緒 に 返す (詳細 ページ の コンテキスト)
  const organizationId = row.organization_id as string;
  const [orgRes, planTierRes] = await Promise.all([
    admin.from("organizations").select("id, name").eq("id", organizationId).maybeSingle(),
    // 「個人 (Solo) org か」 は organization_plans.tier で 判定。
    // organizations.is_personal 列 は 未 追加。
    admin
      .from("organization_plans")
      .select("tier")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  const orgRow = orgRes.data;
  const orgTier = (planTierRes.data as { tier?: string } | null)?.tier;
  const organizationIsPersonal = orgTier === "solo" || orgTier === "solo_pro";

  const memberIds = [row.assigned_member_id, row.created_by_member_id].filter(
    (v) => typeof v === "string" && v.length > 0,
  ) as string[];
  const emailByMemberId = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: memberRows } = await admin
      .from("organization_members")
      .select("id, user_id")
      .in("id", memberIds);
    const rows = (memberRows ?? []) as { id: string; user_id: string }[];
    const userIds = rows.map((m) => m.user_id);
    // 全 ページ 走査 で email を bulk 取得 (perPage=200 の 単発 だと 200 超過 で
    // 該当 email が null に なる)
    const authUsersById = await getAuthUsersByIds(admin, userIds);
    for (const m of rows) {
      const em = authUsersById.get(m.user_id)?.email;
      if (em) emailByMemberId.set(m.id, em);
    }
  }

  // 応募 数 も 返す (詳細 で 便利)
  const { count: referralCount } = await admin
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("client_record_id", id);

  return NextResponse.json({
    client: {
      // 基本
      id: row.id,
      organizationId,
      organizationName: (orgRow as { name?: string } | null)?.name ?? "(不明)",
      organizationIsPersonal,
      name: row.name,
      nameKana: row.name_kana ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      phone2: row.phone2 ?? null,
      email2: row.email2 ?? null,
      status: row.status,
      linkStatus: row.link_status,
      linkedUserId: row.linked_user_id ?? null,
      linkedAt: row.linked_at ?? null,
      revokedAt: row.revoked_at ?? null,
      notes: row.notes ?? null,
      closeReason: row.close_reason ?? null,
      emailDistributionEnabled: Boolean(row.email_distribution_enabled),
      entrySite: row.entry_site ?? null,
      // 属性
      birthDate: row.birth_date ?? null,
      gender: row.gender ?? null,
      nationality: row.nationality ?? null,
      maritalStatus: row.marital_status ?? null,
      // 住所
      postalCode: row.postal_code ?? null,
      prefecture: row.prefecture ?? null,
      city: row.city ?? null,
      street: row.street ?? null,
      building: row.building ?? null,
      // 現職
      currentEmploymentType: row.current_employment_type ?? null,
      currentAnnualIncome: row.current_annual_income ?? null,
      finalEducation: row.final_education ?? null,
      experienceIndustries: (row.experience_industries as string[] | null) ?? [],
      experienceOccupations: (row.experience_occupations as string[] | null) ?? [],
      // 希望
      desiredIndustries: (row.desired_industries as string[] | null) ?? [],
      desiredOccupations: (row.desired_occupations as string[] | null) ?? [],
      desiredLocations: (row.desired_locations as string[] | null) ?? [],
      desiredAnnualIncome: row.desired_annual_income ?? null,
      jobChangeTiming: row.job_change_timing ?? null,
      // 運用日付
      intakeDate: row.intake_date ?? null,
      firstMeetingDate: row.first_meeting_date ?? null,
      // CRM
      crmTags: (row.crm_tags as string[] | null) ?? [],
      customFields: (row.custom_fields as Record<string, unknown> | null) ?? {},
      // 暗号化 フィールド の 「有無」 のみ 出す (中身 は reveal-notes で)
      hasRecommendationComment:
        row.encrypted_recommendation_comment !== null &&
        row.encrypted_recommendation_comment !== "",
      hasOtherAgencyStatus:
        row.encrypted_other_agency_status !== null && row.encrypted_other_agency_status !== "",
      hasContactMethodPreference:
        row.encrypted_contact_method_preference !== null &&
        row.encrypted_contact_method_preference !== "",
      hasEducationDetail:
        row.encrypted_education_detail !== null && row.encrypted_education_detail !== "",
      hasSkills: row.encrypted_skills !== null && row.encrypted_skills !== "",
      hasJobChangeReason:
        row.encrypted_job_change_reason !== null && row.encrypted_job_change_reason !== "",
      hasDesiredConditions:
        row.encrypted_desired_conditions !== null && row.encrypted_desired_conditions !== "",
      hasMeetingNotes: row.encrypted_meeting_notes !== null && row.encrypted_meeting_notes !== "",
      hasStatusMemo: row.encrypted_status_memo !== null && row.encrypted_status_memo !== "",
      // メタ
      assignedMemberId: row.assigned_member_id ?? null,
      assignedMemberEmail: row.assigned_member_id
        ? (emailByMemberId.get(row.assigned_member_id as string) ?? null)
        : null,
      createdByMemberId: row.created_by_member_id ?? null,
      createdByEmail: row.created_by_member_id
        ? (emailByMemberId.get(row.created_by_member_id as string) ?? null)
        : null,
      referralCount: referralCount ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
}
