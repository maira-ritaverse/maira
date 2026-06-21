/**
 * 求職者 個人 設定 ページ 用 の AI 利用 残数 オーバービュー
 *
 * /app/settings の トップ に コンパクト 表示 する ため の 集計 ヘルパー。
 * 各 seeker_per_user scope の kind に つき current / limit を 取得 し
 * UI で バー 表示 でき る 形 に 揃え る。
 *
 * 注意: checkAiUsageLimit は addon / 組織 上限 等 を 考慮 する 重め の RPC
 *       呼出 を 含む ため、 設定 ページ 表示 の たび に 6 件 並列 で 走る。
 *       過剰 に なれ ば revalidate を 入れる が、 現状 は force-dynamic で OK。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkAiUsageLimit, type AiUsageKind } from "@/lib/features/ai-usage";

const SEEKER_KINDS_TO_SHOW: { kind: AiUsageKind; label: string }[] = [
  { kind: "photo_enhance", label: "AI 証明写真" },
  { kind: "job_recommendation_seeker", label: "AI 求人 推薦" },
  { kind: "seeker_resume_create", label: "履歴書 新規 作成" },
  { kind: "seeker_cv_create", label: "職務経歴書 新規 作成" },
  { kind: "seeker_resume_ai_draft", label: "履歴書 AI 下書き" },
  { kind: "seeker_cv_ai_draft", label: "職務経歴書 AI 下書き" },
];

export type SeekerAiUsageRow = {
  kind: AiUsageKind;
  label: string;
  current: number;
  limit: number;
  remaining: number;
  /** limit が 0 の 場合 や 未契約 で 使え ない 状態 か */
  unavailable: boolean;
};

export async function listSeekerAiUsageOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<SeekerAiUsageRow[]> {
  const results = await Promise.all(
    SEEKER_KINDS_TO_SHOW.map(async ({ kind, label }) => {
      const status = await checkAiUsageLimit(supabase, userId, kind);
      const remaining = Math.max(0, status.limit - status.current);
      return {
        kind,
        label,
        current: status.current,
        limit: status.limit,
        remaining,
        unavailable: status.limit === 0,
      };
    }),
  );
  return results;
}
