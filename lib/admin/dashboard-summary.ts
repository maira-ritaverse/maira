/**
 * 運営管理ホーム / ヘッダーで使う集計ヘルパ。
 *
 * 目的:
 *   - 運営者がログイン直後に「今やるべきこと」を即視できるようにする
 *   - count exact head:true の軽量クエリだけで構成し、ホームの初期表示を遅らせない
 *
 * セキュリティ:
 *   - 呼び出し側で isMairaAdmin() ガード前提
 *   - service_role で RLS バイパス(集計は organization 横断のため)
 */
import { sumEstimatedCost } from "@/lib/features/ai-pricing";
import { CURRENT_PRIVACY_POLICY_VERSION } from "@/lib/privacy/policy";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * AI 月次予算(円)。環境変数 AI_MONTHLY_BUDGET_JPY で設定。
 * 0 / 未設定なら予算アラートを出さない(集計のみ表示)。
 */
function getMonthlyBudgetJpy(): number {
  const v = Number(process.env.AI_MONTHLY_BUDGET_JPY ?? "0");
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export type BudgetStatus = "ok" | "warning" | "exceeded" | "unset";

export type AdminDashboardSummary = {
  /** 未読の問い合わせ数(ヘッダーバッジ用) */
  unreadContacts: number;
  /** 直近 30 日(主要指標) */
  recent30d: {
    newUsers: number;
    newApplications: number;
    newOrganizations: number;
    aiCalls: number;
  };
  /** 今月の AI コスト + 予算判定 */
  aiCost: {
    thisMonthJpy: number;
    budgetJpy: number;
    status: BudgetStatus;
    /** 予算に対する到達率(0-100、予算未設定時は null) */
    percent: number | null;
  };
  /** プライバシーポリシー同意分布 */
  privacyPolicy: {
    version: string;
    acceptedCurrent: number;
    acceptedOld: number;
    notAccepted: number;
  };
  /** アラート(対応が必要) */
  alerts: {
    /** admin 不在の組織数 */
    organizationsWithoutAdmin: number;
    /** 90 日以上メンバー追加が無い組織数 */
    dormantOrganizations: number;
  };
};

async function countAll(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}

async function countSince(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  column: string,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(column, sinceIso);
  if (error) return 0;
  return count ?? 0;
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const admin = createServiceClient();
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // 軽量 count クエリは並列で
  const [unread, newUsers, newApplications, newOrganizations, aiCalls] = await Promise.all([
    (async () => {
      const { count } = await admin
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      return count ?? 0;
    })(),
    countSince(admin, "profiles", "created_at", since30d),
    countSince(admin, "applications", "created_at", since30d),
    countSince(admin, "organizations", "created_at", since30d),
    countSince(admin, "ai_usage_events", "created_at", since30d),
  ]);

  // アラート判定は organizations + organization_members を取って集計
  const { data: orgsData } = await admin.from("organizations").select("id");
  const orgs = (orgsData ?? []) as { id: string }[];
  const { data: membersData } = await admin
    .from("organization_members")
    .select("organization_id, role, created_at")
    // soft delete された メンバー は アクティブ 集計 の 対象 外
    .is("removed_at", null);
  const members = (membersData ?? []) as {
    organization_id: string;
    role: "admin" | "advisor";
    created_at: string;
  }[];

  const stats = new Map<string, { adminCount: number; lastMemberAt: string | null }>();
  for (const m of members) {
    const s = stats.get(m.organization_id) ?? { adminCount: 0, lastMemberAt: null };
    if (m.role === "admin") s.adminCount += 1;
    if (!s.lastMemberAt || s.lastMemberAt < m.created_at) {
      s.lastMemberAt = m.created_at;
    }
    stats.set(m.organization_id, s);
  }

  let withoutAdmin = 0;
  let dormant = 0;
  for (const o of orgs) {
    const s = stats.get(o.id) ?? { adminCount: 0, lastMemberAt: null };
    if (s.adminCount === 0) withoutAdmin += 1;
    else if (!s.lastMemberAt || s.lastMemberAt < since90d) dormant += 1;
  }

  // ===== 今月の AI コスト =====
  // ai_usage_events を kind 別に count exact head:true で取り、単価と掛けて見積もる。
  // 並列で 3 クエリ → メモリで合計化。
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const AI_KINDS = [
    "photo_enhance",
    "job_recommendation_seeker",
    "job_recommendation_agency",
  ] as const;
  const aiCountEntries = await Promise.all(
    AI_KINDS.map(async (kind) => {
      const { count } = await admin
        .from("ai_usage_events")
        .select("id", { count: "exact", head: true })
        .eq("kind", kind)
        .gte("created_at", startOfMonth);
      return [kind, count ?? 0] as const;
    }),
  );
  const aiByKind = Object.fromEntries(aiCountEntries) as Record<string, number>;
  const thisMonthCostJpy = sumEstimatedCost(aiByKind);
  const budgetJpy = getMonthlyBudgetJpy();
  const budgetStatus: BudgetStatus = (() => {
    if (budgetJpy === 0) return "unset";
    const pct = (thisMonthCostJpy / budgetJpy) * 100;
    if (pct >= 100) return "exceeded";
    if (pct >= 80) return "warning";
    return "ok";
  })();
  const budgetPercent = budgetJpy === 0 ? null : Math.round((thisMonthCostJpy / budgetJpy) * 100);

  // ===== プライバシーポリシー同意分布 =====
  const [{ count: acceptedCurrent }, { count: acceptedOld }, { count: notAccepted }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("privacy_policy_version", CURRENT_PRIVACY_POLICY_VERSION),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .not("privacy_policy_version", "is", null)
        .neq("privacy_policy_version", CURRENT_PRIVACY_POLICY_VERSION),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .is("privacy_policy_version", null),
    ]);

  // 使われない参照だけ countAll を残しておく(将来「全体ユーザ数」等を加える可能性)
  void countAll;

  return {
    unreadContacts: unread,
    recent30d: {
      newUsers,
      newApplications,
      newOrganizations,
      aiCalls,
    },
    aiCost: {
      thisMonthJpy: thisMonthCostJpy,
      budgetJpy,
      status: budgetStatus,
      percent: budgetPercent,
    },
    privacyPolicy: {
      version: CURRENT_PRIVACY_POLICY_VERSION,
      acceptedCurrent: acceptedCurrent ?? 0,
      acceptedOld: acceptedOld ?? 0,
      notAccepted: notAccepted ?? 0,
    },
    alerts: {
      organizationsWithoutAdmin: withoutAdmin,
      dormantOrganizations: dormant,
    },
  };
}
