/**
 * 既存 ma_scenarios (channel='line') を 新 ma_flows 体系 に Backfill する スクリプト
 *
 * 動作 :
 *   ・全 organizations を 走査
 *   ・各 org で 有効化 済 の LINE 系 ma_scenarios を 抽出
 *   ・対応 する LINE_FLOW_PRESETS から Flow 定義 を 引く
 *   ・冪等性 : 同 org × 同 origin_preset_key で 既に ma_flows 行 が あれば skip
 *   ・ma_flows を is_active=false で INSERT (安全側、 Phase 1 の UI で 有効化)
 *   ・対応 する ma_templates を 探し 出し ma_flow_steps.template_id に 設定
 *   ・trigger_days_override は applyTriggerDaysOverride で trigger_config に 反映
 *
 * 使い方 :
 *   ・dev  : pnpm tsx scripts/backfill-flow-presets.ts --dry-run
 *   ・dev  : pnpm tsx scripts/backfill-flow-presets.ts
 *   ・prod : 別途 .env で prod 値 を 流し 込ん で 実行 (ユーザー 承認 の 上 で)
 *
 * 前提 :
 *   ・supabase/migrations/20260711000001_add_ma_flows_tables.sql が 適用 済
 *   ・.env.local に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * 安全性 :
 *   ・冪等 (origin_preset_key で 判定)。 複数回 流し ても 破壊 しない。
 *   ・全 Flow は is_active=false で 生成。 有効化 は 別途 UI から。
 *   ・失敗 時 は そこ で 停止、 途中 まで の Flow は 残る (次回 は skip される)。
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getLineFlowPresetByKey } from "@/lib/ma/flow-presets";
import { applyTriggerDaysOverride } from "@/lib/ma/flow-preset-types";

const DRY_RUN = process.argv.includes("--dry-run");

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Required env ${name} is not set`);
  }
  return v;
}

type OrgRow = { id: string; name: string | null };

type ScenarioRow = {
  id: string;
  organization_id: string;
  trigger_days_override: number | null;
  is_active: boolean;
  ma_scenario_presets: {
    key: string;
    channel: string;
  } | null;
};

type TemplateRow = {
  id: string;
  scenario_id: string;
};

async function main() {
  const supabase = createSupabaseClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  console.log(`[backfill-flow-presets] mode=${DRY_RUN ? "dry-run" : "apply"}`);

  // 全 org を 取得
  const orgsRes = await supabase.from("organizations").select("id, name");
  if (orgsRes.error) {
    throw orgsRes.error;
  }
  const orgs = (orgsRes.data ?? []) as OrgRow[];
  console.log(`[backfill-flow-presets] orgs=${orgs.length}`);

  let totalCandidates = 0;
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalStepsCreated = 0;
  let totalTemplatesLinked = 0;
  let totalTemplatesMissing = 0;

  for (const org of orgs) {
    // この org で 有効化 されている LINE 系 ma_scenarios を 取得。
    // ma_scenario_presets.channel='line' で 絞る (inner join)。
    const scenariosRes = await supabase
      .from("ma_scenarios")
      .select(
        `
        id,
        organization_id,
        trigger_days_override,
        is_active,
        ma_scenario_presets!inner (
          key,
          channel
        )
      `,
      )
      .eq("organization_id", org.id)
      .eq("ma_scenario_presets.channel", "line");
    if (scenariosRes.error) {
      throw scenariosRes.error;
    }
    const scenarios = (scenariosRes.data ?? []) as unknown as ScenarioRow[];
    if (scenarios.length === 0) {
      continue;
    }

    console.log(
      `[backfill-flow-presets] org=${org.id} (${org.name ?? "-"}) scenarios=${scenarios.length}`,
    );

    for (const scenario of scenarios) {
      totalCandidates++;
      const presetKey = scenario.ma_scenario_presets?.key;
      if (!presetKey) {
        console.warn(`  skip: scenario=${scenario.id} has no preset key (unexpected)`);
        totalSkipped++;
        continue;
      }
      const preset = getLineFlowPresetByKey(presetKey);
      if (!preset) {
        console.warn(`  skip: preset ${presetKey} not defined in LINE_FLOW_PRESETS`);
        totalSkipped++;
        continue;
      }

      // 冪等性 チェック : 既に Backfill 済 か
      const existingRes = await supabase
        .from("ma_flows")
        .select("id")
        .eq("organization_id", org.id)
        .eq("origin_preset_key", presetKey)
        .maybeSingle();
      if (existingRes.error) {
        throw existingRes.error;
      }
      if (existingRes.data) {
        console.log(`  skip: flow already exists (preset=${presetKey})`);
        totalSkipped++;
        continue;
      }

      // trigger_config に override を 反映
      const triggerConfig = applyTriggerDaysOverride(preset, scenario.trigger_days_override);

      if (DRY_RUN) {
        console.log(
          `  [dry-run] would create flow: preset=${presetKey} trigger_config=${JSON.stringify(triggerConfig)}`,
        );
        totalCreated++;
        totalStepsCreated += preset.steps.length;
        continue;
      }

      // Flow を INSERT
      const flowInsert = await supabase
        .from("ma_flows")
        .insert({
          organization_id: org.id,
          name: preset.name,
          description: preset.description,
          channel: preset.channel,
          trigger_type: preset.trigger_type,
          trigger_config: triggerConfig,
          goal_event_key: preset.goal_event_key,
          allow_reentry: preset.allow_reentry,
          is_active: false,
          origin_preset_key: preset.key,
        })
        .select("id")
        .single();
      if (flowInsert.error) {
        throw flowInsert.error;
      }
      const flowId = flowInsert.data.id as string;
      totalCreated++;
      console.log(`  created flow=${flowId} preset=${presetKey}`);

      // 対応 する ma_templates (旧 scenario_id 参照) を 一括 取得
      const templatesRes = await supabase
        .from("ma_templates")
        .select("id, scenario_id")
        .eq("scenario_id", scenario.id);
      if (templatesRes.error) {
        throw templatesRes.error;
      }
      const template = (templatesRes.data ?? [])[0] as TemplateRow | undefined;

      // Steps を INSERT
      for (const step of preset.steps) {
        const templateId = step.action_type === "send_message" ? (template?.id ?? null) : null;
        if (step.action_type === "send_message") {
          if (templateId) {
            totalTemplatesLinked++;
          } else {
            totalTemplatesMissing++;
            console.warn(
              `    warn: send_message step ${step.step_order} has no template (scenario=${scenario.id})`,
            );
          }
        }

        // template_id が null で send_message の 場合、 CHECK 制約 に 引っかかる。
        // 想定 外 だが 安全 の ため INSERT を skip して 手動 対応 に 委ねる。
        if (step.action_type === "send_message" && !templateId) {
          console.warn(
            `    skip step: template missing (flow=${flowId} step_order=${step.step_order})`,
          );
          continue;
        }

        const stepInsert = await supabase.from("ma_flow_steps").insert({
          flow_id: flowId,
          step_order: step.step_order,
          name: step.name,
          delay_from_previous_seconds: step.delay_from_previous_seconds,
          action_type: step.action_type,
          action_config: step.action_config ?? {},
          template_id: templateId,
        });
        if (stepInsert.error) {
          throw stepInsert.error;
        }
        totalStepsCreated++;
      }
    }
  }

  console.log("---");
  console.log(`[backfill-flow-presets] summary`);
  console.log(`  candidates       : ${totalCandidates}`);
  console.log(`  flows created    : ${totalCreated}`);
  console.log(`  flows skipped    : ${totalSkipped}`);
  console.log(`  steps created    : ${totalStepsCreated}`);
  console.log(`  templates linked : ${totalTemplatesLinked}`);
  console.log(`  templates missing: ${totalTemplatesMissing}`);
  console.log(`[backfill-flow-presets] done (${DRY_RUN ? "dry-run, no writes" : "applied"})`);
}

main().catch((err) => {
  console.error(`[backfill-flow-presets] error:`, err);
  process.exit(1);
});
