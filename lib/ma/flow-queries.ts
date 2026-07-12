/**
 * ma_flows / ma_flow_steps / ma_flow_subscriptions の 共通 クエリ ヘルパー。
 *
 * 使用 場所 :
 *   ・app/(agency)/agency/marketing/flows/page.tsx (一覧 表示)
 *   ・app/(agency)/agency/marketing/flows/[id]/edit/page.tsx (詳細、 Phase 1-F)
 *   ・app/api/agency/ma/flows/route.ts (GET / POST / PATCH)
 *
 * 認可 :
 *   ・呼び出し 側 で organization_id スコープ を 保証 する 前提
 *     (server component は requireOrgMember 済 / RLS 経由 SELECT)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Flow ステップ の template_id 選択肢 用。 line チャネル の ma_templates を
 * 関連 ma_scenarios の preset 名 と 組んで 返す。
 *
 * ma_templates.scenario_id NOT NULL 制約 の ため、 現時点 の 選択肢 は
 * 既存 プリセット (7 種) の うち 「テンプレ が 作成 済 の もの」 に 限る。
 * 独立 template 管理 は 後日 (scenario_id nullable 化 + テンプレ CRUD UI)。
 */
export type MaTemplateOption = {
  id: string;
  scenario_key: string;
  scenario_name: string;
  updated_at: string;
};

export async function listMaTemplatesForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<MaTemplateOption[]> {
  const { data, error } = await supabase
    .from("ma_templates")
    .select(
      `
      id,
      updated_at,
      ma_scenarios!inner (
        organization_id,
        ma_scenario_presets!inner (key, name, channel)
      )
    `,
    )
    .eq("ma_scenarios.organization_id", organizationId)
    .eq("ma_scenarios.ma_scenario_presets.channel", "line");
  if (error) throw error;

  type Row = {
    id: string;
    updated_at: string;
    ma_scenarios: {
      ma_scenario_presets: { key: string; name: string } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const preset = r.ma_scenarios?.ma_scenario_presets;
      if (!preset) return null;
      return {
        id: r.id,
        scenario_key: preset.key,
        scenario_name: preset.name,
        updated_at: r.updated_at,
      };
    })
    .filter((t): t is MaTemplateOption => t !== null);
}

/**
 * 一覧 表示 用 の 集約 済 Flow 行。
 */
export type FlowListItem = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  origin_preset_key: string | null;
  goal_event_key: string | null;
  allow_reentry: boolean;
  created_at: string;
  updated_at: string;
  step_count: number;
  active_subscription_count: number;
};

/**
 * org 単位 で Flow 一覧 を 取得。 step 数 と active subscription 数 は
 * 別 count クエリ で 集約 (ma_flows に は キャッシュ 列 を 持って いない)。
 */
export async function listFlowsForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<FlowListItem[]> {
  const { data: flowsData, error: flowsErr } = await supabase
    .from("ma_flows")
    .select(
      "id, name, description, trigger_type, is_active, origin_preset_key, goal_event_key, allow_reentry, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (flowsErr) throw flowsErr;

  const flows = (flowsData ?? []) as Omit<
    FlowListItem,
    "step_count" | "active_subscription_count"
  >[];
  if (flows.length === 0) return [];

  const flowIds = flows.map((f) => f.id);

  // step 数 (flow_id ごと に count)
  const { data: stepRows } = await supabase
    .from("ma_flow_steps")
    .select("flow_id")
    .in("flow_id", flowIds);
  const stepCountMap = new Map<string, number>();
  for (const r of (stepRows ?? []) as Array<{ flow_id: string }>) {
    stepCountMap.set(r.flow_id, (stepCountMap.get(r.flow_id) ?? 0) + 1);
  }

  // active subscription 数
  const { data: subRows } = await supabase
    .from("ma_flow_subscriptions")
    .select("flow_id")
    .in("flow_id", flowIds)
    .eq("status", "active");
  const subCountMap = new Map<string, number>();
  for (const r of (subRows ?? []) as Array<{ flow_id: string }>) {
    subCountMap.set(r.flow_id, (subCountMap.get(r.flow_id) ?? 0) + 1);
  }

  return flows.map((f) => ({
    ...f,
    step_count: stepCountMap.get(f.id) ?? 0,
    active_subscription_count: subCountMap.get(f.id) ?? 0,
  }));
}

/**
 * 詳細 表示 用 の 1 Flow + Step 配列。 Phase 1-F の 編集 画面 で 使う。
 */
export type FlowDetail = FlowListItem & {
  organization_id: string;
  channel: string;
  trigger_config: Record<string, unknown>;
  target_segment_id: string | null;
  max_send_per_day: number | null;
  send_time_window_json: unknown;
  steps: FlowStepRow[];
};

export type FlowStepRow = {
  id: string;
  flow_id: string;
  step_order: number;
  name: string | null;
  delay_from_previous_seconds: number;
  action_type: string;
  action_config: Record<string, unknown>;
  template_id: string | null;
  branch_condition_json: unknown;
  next_step_on_true: number | null;
  next_step_on_false: number | null;
  next_step_on_default: number | null;
  goal_check_on_entry: boolean;
  /** Phase 1-F.2:自由 DAG エディタ の 位置。 null なら 自動 レイアウト。 */
  position_x: number | null;
  position_y: number | null;
};

export async function getFlowDetail(
  supabase: SupabaseClient,
  organizationId: string,
  flowId: string,
): Promise<FlowDetail | null> {
  const { data: flow } = await supabase
    .from("ma_flows")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", flowId)
    .maybeSingle();
  if (!flow) return null;

  const { data: steps } = await supabase
    .from("ma_flow_steps")
    .select("*")
    .eq("flow_id", flowId)
    .order("step_order", { ascending: true });

  const { data: subCount } = await supabase
    .from("ma_flow_subscriptions")
    .select("id")
    .eq("flow_id", flowId)
    .eq("status", "active");

  const f = flow as Omit<FlowDetail, "steps" | "step_count" | "active_subscription_count">;
  return {
    ...f,
    steps: (steps ?? []) as FlowStepRow[],
    step_count: (steps ?? []).length,
    active_subscription_count: (subCount ?? []).length,
  };
}
