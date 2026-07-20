/**
 * /api/agency/ma/flows
 *
 * GET   :自組織 の Flow 一覧 (集約 済) を 返す
 * POST  :Flow を 新規 作成 (プリセット から or 空白)
 * PATCH :Flow の is_active を 切替 (body に { id, is_active })
 *
 * 認可 :
 *   ・GET:organization member (advisor / admin)
 *   ・POST / PATCH:organization admin のみ
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getEntitlementsForOrg,
  planUpgradeRequired,
  requireOrgAdmin,
  requireOrgMember,
} from "@/lib/api/auth-guards";
import { logFlowAudit } from "@/lib/ma/flow-audit";
import { listFlowsForOrg } from "@/lib/ma/flow-queries";
import { getLineFlowPresetByKey } from "@/lib/ma/flow-presets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// ────────────────────────────────────────
// GET
// ────────────────────────────────────────
/**
 * MA 機能 は Team 系 プラン 限定。 Solo 系 で は 使えない ので 402 で 弾く。
 */
const MA_UPGRADE_MESSAGE =
  "マーケティングオートメーション機能はTeamプラン以上でご利用いただけます。";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const entitlements = await getEntitlementsForOrg(guard.supabase);
  if (!entitlements.canUseMaFlows) return planUpgradeRequired(MA_UPGRADE_MESSAGE);

  try {
    const flows = await listFlowsForOrg(guard.supabase, guard.organization.id);
    return NextResponse.json({ flows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "fetch_failed", message: msg }, { status: 500 });
  }
}

// ────────────────────────────────────────
// POST (Flow 新規 作成)
// ────────────────────────────────────────
const postBody = z.object({
  /** LINE_FLOW_PRESETS の key。 null なら 空白 Flow を 作成。 */
  preset_key: z.string().nullable(),
  /** preset_key 未指定 時 の 表示 名 (必須)。 preset 指定 時 は 上書き 用 (任意)。 */
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  /** 送信チャネル。 preset 指定時は preset 側で LINE 固定、 空白時のみ選択可。 */
  channel: z.enum(["line", "email"]).optional(),
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const entitlements = await getEntitlementsForOrg(guard.supabase);
  if (!entitlements.canUseMaFlows) return planUpgradeRequired(MA_UPGRADE_MESSAGE);

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // プリセット 由来 の 場合 は 定義 から メタ を コピー(プリセットは LINE 用のみなので channel='line')
  // 空白 Flow の場合のみ、 リクエストの channel を尊重する('line' or 'email')
  let insertRow: Record<string, unknown> = {
    organization_id: guard.organization.id,
    channel: "line",
    is_active: false,
    created_by: guard.user.id,
  };

  if (parsed.data.preset_key) {
    const preset = getLineFlowPresetByKey(parsed.data.preset_key);
    if (!preset) {
      return NextResponse.json({ error: "unknown_preset" }, { status: 400 });
    }
    insertRow = {
      ...insertRow,
      channel: "line",
      name: parsed.data.name ?? preset.name,
      description: parsed.data.description ?? preset.description,
      trigger_type: preset.trigger_type,
      trigger_config: preset.trigger_config,
      goal_event_key: preset.goal_event_key,
      allow_reentry: preset.allow_reentry,
      origin_preset_key: preset.key,
    };
  } else {
    // 空白 Flow:name 必須、 trigger は 'manual' (後で 編集 画面 で 変更)
    if (!parsed.data.name) {
      return NextResponse.json({ error: "name_required_for_blank" }, { status: 400 });
    }
    insertRow = {
      ...insertRow,
      channel: parsed.data.channel ?? "line",
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      trigger_type: "manual",
      trigger_config: {},
      goal_event_key: null,
      allow_reentry: false,
      origin_preset_key: null,
    };
  }

  const { data, error } = await admin.from("ma_flows").insert(insertRow).select("id").single();
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  await logFlowAudit(admin, {
    organization_id: guard.organization.id,
    flow_id: data.id as string,
    action: "create",
    actor_user_id: guard.user.id,
    diff_summary: {
      preset_key: parsed.data.preset_key,
      name: insertRow.name,
    },
  });

  return NextResponse.json({ ok: true, id: data.id });
}

// ────────────────────────────────────────
// PATCH (メタデータ 部分 更新)
//
// 少なくとも 1 つ の 編集 可能 フィールド を 含める 必要 が ある。
// 変更 不可 : id / organization_id / trigger_type (再作成 で 対応)
// ────────────────────────────────────────
const patchBody = z.object({
  id: z.string().uuid(),
  is_active: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  goal_event_key: z.string().max(100).nullable().optional(),
  allow_reentry: z.boolean().optional(),
  max_send_per_day: z.number().int().min(1).nullable().optional(),
  target_segment_id: z.string().uuid().nullable().optional(),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const entitlements = await getEntitlementsForOrg(guard.supabase);
  if (!entitlements.canUseMaFlows) return planUpgradeRequired(MA_UPGRADE_MESSAGE);

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // id 以外 で 実際 に 送られた フィールド のみ 更新
  const patch: Record<string, unknown> = {};
  for (const key of [
    "is_active",
    "name",
    "description",
    "goal_event_key",
    "allow_reentry",
    "max_send_per_day",
    "target_segment_id",
    "trigger_config",
  ] as const) {
    if (parsed.data[key] !== undefined) {
      patch[key] = parsed.data[key];
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const { error } = await admin
    .from("ma_flows")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // is_active だけの変更なら toggle_active、それ以外はメタ変更として記録
  const changedKeys = Object.keys(patch);
  const isToggleOnly = changedKeys.length === 1 && changedKeys[0] === "is_active";
  await logFlowAudit(admin, {
    organization_id: guard.organization.id,
    flow_id: parsed.data.id,
    action: isToggleOnly ? "toggle_active" : "update_meta",
    actor_user_id: guard.user.id,
    diff_summary: isToggleOnly ? { is_active: patch.is_active } : { fields: changedKeys },
  });

  return NextResponse.json({ ok: true });
}
