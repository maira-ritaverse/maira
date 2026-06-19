/**
 * 組織管理者(agency admin)向け AI 利用状況の取得ヘルパ。
 * RPC `get_org_ai_usage_summary` のラッパ + UI 用整形。
 */
import { utcMonthStart } from "@/lib/features/usage-limits";
import { createClient } from "@/lib/supabase/server";
import {
  AGENCY_CV_DRAFT_FREE_MONTHLY,
  AGENCY_RESUME_DRAFT_FREE_MONTHLY,
  JOB_EXTRACT_FROM_DOCUMENT_FREE_MONTHLY,
  JOB_RECOMMENDATION_AGENCY_FREE_MONTHLY,
  JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY,
  PHOTO_ENHANCE_FREE_MONTHLY,
  RECOMMENDATION_LETTER_DRAFT_FREE_MONTHLY,
  type AiUsageKind,
} from "@/lib/features/ai-usage";

export type AiUsageMemberSummary = {
  userId: string;
  displayName: string;
  email: string;
  byKind: Record<string, number>;
  total: number;
};

export type OrgAiUsageSummary = {
  monthStart: string;
  members: AiUsageMemberSummary[];
  /** 全メンバー横断の kind 別合計(コスト概算用) */
  byKindTotal: Record<string, number>;
  grandTotal: number;
};

type RpcRow = {
  user_id: string;
  display_name: string;
  email: string;
  kind: string | null;
  event_count: number;
};

export async function getOrgAiUsageSummary(): Promise<OrgAiUsageSummary> {
  const supabase = await createClient();
  const monthStart = utcMonthStart();
  const { data, error } = await supabase.rpc("get_org_ai_usage_summary", {
    p_month_start: monthStart.toISOString(),
  });
  if (error) {
    throw new Error(`get_org_ai_usage_summary failed: ${error.message}`);
  }
  const rows = (data ?? []) as RpcRow[];

  // user_id ごとに集約
  const byUser = new Map<string, AiUsageMemberSummary>();
  const byKindTotal: Record<string, number> = {};
  for (const r of rows) {
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, {
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        byKind: {},
        total: 0,
      });
    }
    const m = byUser.get(r.user_id)!;
    if (r.kind) {
      const count = Number(r.event_count) || 0;
      m.byKind[r.kind] = (m.byKind[r.kind] ?? 0) + count;
      m.total += count;
      byKindTotal[r.kind] = (byKindTotal[r.kind] ?? 0) + count;
    }
  }
  const members = [...byUser.values()].sort(
    (a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName),
  );
  const grandTotal = members.reduce((s, m) => s + m.total, 0);
  return {
    monthStart: monthStart.toISOString(),
    members,
    byKindTotal,
    grandTotal,
  };
}

// AI_KIND_LABEL / AI_KIND_SCOPE_LABEL / AI_KIND_UNIT_COST_USD / estimateCostUsd は
// クライアントコンポーネントからも読み込めるよう lib/agency/ai-kind-labels.ts に
// 切り出した。本ファイルは Supabase server 依存があるので、Client Component から
// 直接 import すると Next.js のビルドが落ちる。
// 本ファイル内でも 使うので import + re-export の二段にする。
import {
  AI_KIND_LABEL,
  AI_KIND_SCOPE_LABEL,
  AI_KIND_UNIT_COST_USD,
  estimateCostUsd,
} from "./ai-kind-labels";
export { AI_KIND_LABEL, AI_KIND_SCOPE_LABEL, AI_KIND_UNIT_COST_USD, estimateCostUsd };

/** 既定値マップ(レコードが無い kind の フォールバック表示用) */
export const AI_KIND_FREE_DEFAULT: Record<AiUsageKind, number> = {
  photo_enhance: PHOTO_ENHANCE_FREE_MONTHLY,
  job_recommendation_seeker: JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY,
  job_recommendation_agency: JOB_RECOMMENDATION_AGENCY_FREE_MONTHLY,
  recommendation_letter_draft: RECOMMENDATION_LETTER_DRAFT_FREE_MONTHLY,
  agency_cv_draft: AGENCY_CV_DRAFT_FREE_MONTHLY,
  agency_resume_draft: AGENCY_RESUME_DRAFT_FREE_MONTHLY,
  job_extract_from_document: JOB_EXTRACT_FROM_DOCUMENT_FREE_MONTHLY,
};

export type AiQuotaRow = {
  kind: AiUsageKind;
  /** null = 未設定(既定値が適用) */
  monthlyLimit: number | null;
  /** 既定値の参考表示用 */
  defaultLimit: number;
  /** 上限の対象(組織横断 or 求職者 1 人あたり) */
  scope: "agency_org" | "seeker_per_user";
  updatedAt: string | null;
};

/**
 * 自組織の AI quota 設定を 全 kind 分 取得する。
 * RPC `get_organization_ai_quotas` が 返す行を ベースに、レコードが 無い kind は
 * monthlyLimit=null として 埋める(UI 側で「既定値」表示)。
 */
export async function getOrganizationAiQuotas(): Promise<AiQuotaRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_ai_quotas");
  if (error) {
    throw new Error(`get_organization_ai_quotas failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    kind: string;
    monthly_limit: number | null;
    updated_at: string;
  }>;
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  const kinds: AiUsageKind[] = [
    "photo_enhance",
    "job_recommendation_seeker",
    "job_recommendation_agency",
    "recommendation_letter_draft",
    "agency_cv_draft",
    "agency_resume_draft",
    "job_extract_from_document",
  ];
  return kinds.map((kind) => {
    const found = byKind.get(kind);
    return {
      kind,
      monthlyLimit: found ? found.monthly_limit : null,
      defaultLimit: AI_KIND_FREE_DEFAULT[kind],
      scope: AI_KIND_SCOPE_LABEL[kind],
      updatedAt: found?.updated_at ?? null,
    };
  });
}

export type MonthlyTrendPoint = {
  monthLabel: string; // "2026/04"
  monthStart: string; // ISO
  byKind: Record<string, number>;
  total: number;
  costUsd: number;
};

/**
 * 過去 N か月の AI 利用推移を取得。get_org_ai_usage_summary を N 回呼ぶ簡易実装。
 * 月数が多いと遅くなるが、6 か月程度なら実用 OK(60 ミリ秒以内目安)。
 *
 * 厳密には「月初の境界」を UTC で揃えた範囲を毎回計算し、
 * RPC は「>= p_month_start」フィルタしか持たないので、当月差分は
 * 「当月 - 翌月初の差」で算出する(下位の関数を変えずに済むため)。
 */
export async function getOrgAiUsageTrend(monthsBack: number = 6): Promise<MonthlyTrendPoint[]> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const now = new Date();
  // 現在月初(UTC)を起点に過去 N 月の月初を作る
  const monthStarts: Date[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    monthStarts.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  }

  // 各月初以降の累計を並列取得(N+1 直列回避)。
  // 6 か月 × ~150ms / 1 RPC = 900ms 直列 → 並列で ~150ms に短縮(p95)。
  const cumulatives = await Promise.all(
    monthStarts.map(async (ms) => {
      const { data, error } = await supabase.rpc("get_org_ai_usage_summary", {
        p_month_start: ms.toISOString(),
      });
      if (error) return { monthStart: ms, byKind: {} as Record<string, number> };
      const byKind: Record<string, number> = {};
      for (const r of (data ?? []) as Array<{ kind: string | null; event_count: number }>) {
        if (r.kind) byKind[r.kind] = (byKind[r.kind] ?? 0) + (Number(r.event_count) || 0);
      }
      return { monthStart: ms, byKind };
    }),
  );

  // 累計から月別単独を逆算:この月の値 = この月以降の累計 - 次月以降の累計
  const trend: MonthlyTrendPoint[] = [];
  for (let i = 0; i < cumulatives.length; i++) {
    const cur = cumulatives[i].byKind;
    const next = cumulatives[i + 1]?.byKind ?? {};
    const monthOnly: Record<string, number> = {};
    for (const k of Object.keys({ ...cur, ...next })) {
      const diff = (cur[k] ?? 0) - (next[k] ?? 0);
      if (diff > 0) monthOnly[k] = diff;
    }
    const ms = cumulatives[i].monthStart;
    trend.push({
      monthStart: ms.toISOString(),
      monthLabel: `${ms.getUTCFullYear()}/${String(ms.getUTCMonth() + 1).padStart(2, "0")}`,
      byKind: monthOnly,
      total: Object.values(monthOnly).reduce((s, v) => s + v, 0),
      costUsd: estimateCostUsd(monthOnly),
    });
  }
  return trend;
}
