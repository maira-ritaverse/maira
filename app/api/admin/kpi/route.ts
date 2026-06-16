import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/kpi
 *
 * 運営者用:プラットフォーム全体の KPI。
 *
 * 累計指標:
 *   - userCount         : 全ユーザ数(profiles)
 *   - seekerCount       : 求職者
 *   - memberCount       : エージェント企業メンバー
 *   - organizationCount : エージェント企業数
 *   - resumeCount       : 履歴書数
 *   - cvCount           : 職務経歴書数
 *   - applicationCount  : 応募数
 *   - placementCount    : 成約件数(placement イベント数)
 *   - careerProfileCount: 棚卸し完了数
 *
 * 直近 30 日:
 *   - newUsers30d  : 新規登録ユーザ
 *   - applicationsCreated30d : 新規応募
 *
 * 集計は count exact head:true で軽量。RLS バイパスのため service_role を使う。
 */
async function countAll(supabase: ReturnType<typeof createServiceClient>, table: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

async function countSince(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  column: string,
  sinceIso: string,
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(column, sinceIso);
  if (error) return null;
  return count ?? 0;
}

export async function GET() {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createServiceClient();
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 累計
  const [
    userCount,
    organizationCount,
    memberCount,
    resumeCount,
    cvCount,
    applicationCount,
    placementCount,
    careerProfileCount,
  ] = await Promise.all([
    countAll(admin, "profiles"),
    countAll(admin, "organizations"),
    countAll(admin, "organization_members"),
    countAll(admin, "resumes"),
    countAll(admin, "cvs"),
    countAll(admin, "applications"),
    countAll(admin, "placements"),
    countAll(admin, "career_profiles"),
  ]);

  // account_type 別(seeker / organization_member)
  const { data: seekerData } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("account_type", "seeker");
  const seekerCount = (seekerData as unknown as { count?: number } | null)?.count ?? null;
  // Supabase の count は head:true 時に data ではなく count 経由で返るので別取得
  const { count: seekerCountActual } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("account_type", "seeker");

  // 直近 30 日
  const [newUsers30d, applicationsCreated30d, placementsCreated30d] = await Promise.all([
    countSince(admin, "profiles", "created_at", since30d),
    countSince(admin, "applications", "created_at", since30d),
    countSince(admin, "placements", "created_at", since30d),
  ]);

  // ===== 新規導入リード KPI =====
  // 「新規導入のお問い合わせ」プレフィックスを持つ contact_messages の累計
  const { count: signupInquiryTotalRaw } = await admin
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .ilike("message", "[新規導入のお問い合わせ]%");
  const signupInquiryTotal = signupInquiryTotalRaw ?? 0;

  // 発行された組織のうち、問い合わせ受信箱由来のもの(audit_logs の metadata.from_contact_id IS NOT NULL)
  // event_subtype = admin_created_organization で絞る。
  // metadata は jsonb なので ->> でテキスト抽出。
  const { count: convertedTotalRaw } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "admin_accessed_user")
    .filter("metadata->>event_subtype", "eq", "admin_created_organization")
    .not("metadata->>from_contact_id", "is", null);
  const convertedTotal = convertedTotalRaw ?? 0;

  const conversionRatePct =
    signupInquiryTotal > 0 ? Math.round((convertedTotal / signupInquiryTotal) * 1000) / 10 : null;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    cumulative: {
      userCount,
      seekerCount: seekerCountActual ?? seekerCount,
      memberCount,
      organizationCount,
      resumeCount,
      cvCount,
      applicationCount,
      placementCount,
      careerProfileCount,
    },
    last30d: {
      newUsers: newUsers30d,
      applicationsCreated: applicationsCreated30d,
      placementsCreated: placementsCreated30d,
    },
    lead: {
      signupInquiryTotal,
      convertedTotal,
      conversionRatePct, // null = 母数 0(計算不能)
    },
  });
}
