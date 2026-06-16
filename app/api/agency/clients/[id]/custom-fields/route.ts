import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { rowToCustomFieldDefinition, validateValue } from "@/lib/custom-fields/types";
import { logClientChanges } from "@/lib/audit/client-audit-log";

/**
 * PATCH /api/agency/clients/[id]/custom-fields
 *
 * 1 クライアントのカスタムフィールド値を部分更新する。
 * - Body: { values: { [key]: any } }
 * - 各 key を definitions と照合して validate
 * - 値は client_records.custom_fields(jsonb)に「マージ」して保存
 * - 変更は client_audit_log に "custom:<key>" の field_name で残す
 */

const requestSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 定義を取得して送信値を validate
  const { data: defRows, error: defErr } = await supabase
    .from("client_custom_field_definitions")
    .select("*")
    .eq("organization_id", role.organization.id);
  if (defErr) {
    return NextResponse.json(
      { error: "Failed to load definitions", message: defErr.message },
      { status: 500 },
    );
  }
  const defs = ((defRows ?? []) as Parameters<typeof rowToCustomFieldDefinition>[0][]).map(
    rowToCustomFieldDefinition,
  );
  const defByKey = new Map(defs.map((d) => [d.key, d]));

  const validated: Record<string, unknown> = {};
  const validationErrors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed.data.values)) {
    const def = defByKey.get(key);
    if (!def) {
      // 未知のキーは無視(definitions を削除後に古い JSON が残っているケースに寛容)
      continue;
    }
    const v = validateValue(def, raw);
    if (!v.ok) {
      validationErrors[key] = v.error;
      continue;
    }
    validated[key] = v.value;
  }
  if (Object.keys(validationErrors).length > 0) {
    return NextResponse.json(
      { error: "Validation failed", details: validationErrors },
      { status: 400 },
    );
  }

  // 既存値を取得して、変更されたキーだけ監査ログに残す + マージして上書き保存
  const { data: oldRow } = await supabase
    .from("client_records")
    .select("custom_fields")
    .eq("id", id)
    .eq("organization_id", role.organization.id)
    .maybeSingle();
  const oldValues = (oldRow?.custom_fields ?? {}) as Record<string, unknown>;

  // マージ:undefined / null は「クリア」として削除、それ以外は上書き
  const merged: Record<string, unknown> = { ...oldValues };
  const changes: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }> =
    [];
  for (const [key, value] of Object.entries(validated)) {
    if (value === null || value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
    const ov = serialize(oldValues[key] ?? null);
    const nv = serialize(value ?? null);
    if (ov !== nv) {
      changes.push({ fieldName: `custom:${key}`, oldValue: ov, newValue: nv });
    }
  }

  const { error: updErr } = await supabase
    .from("client_records")
    .update({ custom_fields: merged })
    .eq("id", id)
    .eq("organization_id", role.organization.id);
  if (updErr) {
    return NextResponse.json(
      { error: "Failed to update", message: updErr.message },
      { status: 500 },
    );
  }

  if (changes.length > 0) {
    await logClientChanges(
      {
        organizationId: role.organization.id,
        clientRecordId: id,
        actorMemberId: role.member.id,
      },
      changes,
    );
  }

  return NextResponse.json({ success: true });
}

function serialize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v === "" ? null : v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}
