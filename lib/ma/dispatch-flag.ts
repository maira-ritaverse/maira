/**
 * MA 配信 の 実行 系統 (old / new) を org 単位 で 判定 する ヘルパー。
 *
 * Phase 1 P1-D の 段階 カットオーバー 用。 旧 line-dispatch cron が 'new' org を
 * skip する / 将来 の flow-dispatch cron が 'old' org を skip する 際 に 使う。
 *
 * DB 側 :organizations.ma_dispatch_engine 列 (default 'old')
 * 移行 : docs/line-lstep-ma-phase1-plan.md §4.4 の Stage 1〜4
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MADispatchEngine = "old" | "new";

/**
 * 単一 org の dispatch_engine を 取得。 見つから ない / エラー は 'old' 扱い (安全側)。
 */
export async function getOrgDispatchEngine(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<MADispatchEngine> {
  const { data } = await supabase
    .from("organizations")
    .select("ma_dispatch_engine")
    .eq("id", organizationId)
    .maybeSingle();
  const engine = (data as { ma_dispatch_engine?: string } | null)?.ma_dispatch_engine;
  return engine === "new" ? "new" : "old";
}

/**
 * 指定 engine の org ID セット を 一括 取得。 cron が 大量 org を 一気に フィルタ する 用途。
 */
export async function getOrgIdsByDispatchEngine(
  supabase: SupabaseClient,
  engine: MADispatchEngine,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("ma_dispatch_engine", engine);
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}

/**
 * org の dispatch_engine を 更新。 admin UI や 運用 スクリプト から 呼ぶ。
 * 制約: ('old' | 'new') 以外 は CHECK 制約 で 拒否 される。
 */
export async function setOrgDispatchEngine(
  supabase: SupabaseClient,
  organizationId: string,
  engine: MADispatchEngine,
): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ ma_dispatch_engine: engine })
    .eq("id", organizationId);
  if (error) throw error;
}
