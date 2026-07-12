/**
 * POST /api/agency/ma/flows/[id]/ai-improve/apply
 *
 * AI 改善提案の 1 件を実際の Flow に適用する。担当者が「適用」ボタンを押したら
 * 呼ばれる。適用種別(kind)に応じて、Flow メタ情報の更新、ステップの
 * 待機秒・名前・本文の更新、ステップ削除などを実施する。
 *
 * 認可:organization admin のみ、Flow が自組織のものであることを確認
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { AISuggestionApplySchema } from "@/lib/ai/prompts/flow-improvement";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const { id: flowId } = await context.params;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = AISuggestionApplySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Flow が自組織のものか確認
  const { data: flow } = await admin
    .from("ma_flows")
    .select("id, organization_id")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow || flow.organization_id !== guard.organization.id) {
    return NextResponse.json({ error: "flow_not_found" }, { status: 404 });
  }

  const suggestion = parsed.data;

  try {
    switch (suggestion.kind) {
      case "advisory_only":
        return NextResponse.json({ ok: true, applied: false, reason: "advisory_only" });

      case "update_flow_meta": {
        const patch: Record<string, unknown> = {};
        if (suggestion.changes.name != null) patch.name = suggestion.changes.name;
        if (suggestion.changes.description != null)
          patch.description = suggestion.changes.description;
        if (suggestion.changes.goal_event_key !== null)
          patch.goal_event_key = suggestion.changes.goal_event_key;
        if (suggestion.changes.allow_reentry != null)
          patch.allow_reentry = suggestion.changes.allow_reentry;
        if (suggestion.changes.max_send_per_day !== null)
          patch.max_send_per_day = suggestion.changes.max_send_per_day;

        if (Object.keys(patch).length === 0) {
          return NextResponse.json({ ok: true, applied: false, reason: "no_changes" });
        }
        const { error } = await admin.from("ma_flows").update(patch).eq("id", flowId);
        if (error)
          return NextResponse.json(
            { error: "update_failed", message: error.message },
            { status: 500 },
          );
        return NextResponse.json({ ok: true, applied: true });
      }

      case "update_step_delay": {
        const { error } = await admin
          .from("ma_flow_steps")
          .update({ delay_from_previous_seconds: suggestion.new_delay_seconds })
          .eq("flow_id", flowId)
          .eq("step_order", suggestion.step_order);
        if (error)
          return NextResponse.json(
            { error: "update_failed", message: error.message },
            { status: 500 },
          );
        return NextResponse.json({ ok: true, applied: true });
      }

      case "update_step_name": {
        const { error } = await admin
          .from("ma_flow_steps")
          .update({ name: suggestion.new_name })
          .eq("flow_id", flowId)
          .eq("step_order", suggestion.step_order);
        if (error)
          return NextResponse.json(
            { error: "update_failed", message: error.message },
            { status: 500 },
          );
        return NextResponse.json({ ok: true, applied: true });
      }

      case "update_step_body": {
        // 該当ステップの template_id を取得
        const { data: step } = await admin
          .from("ma_flow_steps")
          .select("template_id")
          .eq("flow_id", flowId)
          .eq("step_order", suggestion.step_order)
          .maybeSingle();
        if (!step) {
          return NextResponse.json({ error: "step_not_found" }, { status: 404 });
        }
        const encryptedBody = await encryptField(suggestion.new_body);

        if (step.template_id) {
          // 既存テンプレートの本文を更新
          const { error } = await admin
            .from("ma_templates")
            .update({ encrypted_body: encryptedBody })
            .eq("id", step.template_id);
          if (error)
            return NextResponse.json(
              { error: "template_update_failed", message: error.message },
              { status: 500 },
            );
        } else {
          // テンプレートがないので新規作成してステップに割り当て
          const encryptedSubject = await encryptField("");
          const { data: newTpl, error: insErr } = await admin
            .from("ma_templates")
            .insert({
              organization_id: guard.organization.id,
              scenario_id: null,
              name: `AI 修正 - ステップ${suggestion.step_order}`,
              encrypted_body: encryptedBody,
              encrypted_subject: encryptedSubject,
            })
            .select("id")
            .single();
          if (insErr || !newTpl) {
            return NextResponse.json(
              { error: "template_create_failed", message: insErr?.message ?? "unknown" },
              { status: 500 },
            );
          }
          const { error: assignErr } = await admin
            .from("ma_flow_steps")
            .update({
              template_id: newTpl.id,
              action_type: "send_message",
            })
            .eq("flow_id", flowId)
            .eq("step_order", suggestion.step_order);
          if (assignErr)
            return NextResponse.json(
              { error: "step_update_failed", message: assignErr.message },
              { status: 500 },
            );
        }
        return NextResponse.json({ ok: true, applied: true });
      }

      case "remove_step": {
        const { error } = await admin
          .from("ma_flow_steps")
          .delete()
          .eq("flow_id", flowId)
          .eq("step_order", suggestion.step_order);
        if (error)
          return NextResponse.json(
            { error: "delete_failed", message: error.message },
            { status: 500 },
          );
        return NextResponse.json({ ok: true, applied: true });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "apply_failed", message: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}
