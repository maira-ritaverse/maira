import { NextResponse } from "next/server";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import {
  deleteApplicationPrCustomization,
  getApplicationPrCustomization,
  prOverridesSchema,
  saveApplicationPrCustomization,
} from "@/lib/applications/pr-customizations";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/applications/[id]/pr-customization
 *
 * 応募 1 件分のカスタマイズ(志望動機 / 自己 PR の差し替え)を返す。
 * 存在しなければ overrides: {} を返す(UI 上は「未カスタマイズ」)。
 */
export async function GET(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { id } = await params;

  // 応募の所有者チェック(RLS でも担保されるが防御的に)
  const { data: app } = await supabase
    .from("applications")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!app) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if ((app as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const custom = await getApplicationPrCustomization(id);
  return NextResponse.json({
    applicationId: id,
    overrides: custom?.overrides ?? {},
    baseResumeId: custom?.baseResumeId ?? null,
    baseCvId: custom?.baseCvId ?? null,
    updatedAt: custom?.updatedAt ?? null,
  });
}

/**
 * PUT /api/applications/[id]/pr-customization
 *
 * 応募 1 件分のカスタマイズを保存(upsert)。
 * Body: { overrides: PrOverrides, baseResumeId?: string|null, baseCvId?: string|null }
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { id } = await params;

  // 応募の所有者チェック
  const { data: app } = await supabase
    .from("applications")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!app || (app as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const body = json.body as {
    overrides?: unknown;
    baseResumeId?: string | null;
    baseCvId?: string | null;
  };
  const v = prOverridesSchema.safeParse(body.overrides);
  if (!v.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  try {
    await saveApplicationPrCustomization({
      applicationId: id,
      userId: user.id,
      baseResumeId: body.baseResumeId ?? null,
      baseCvId: body.baseCvId ?? null,
      overrides: v.data,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "save_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/applications/[id]/pr-customization
 *
 * カスタマイズを削除して「ベース文書をそのまま使う」状態に戻す。
 */
export async function DELETE(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { id } = await params;

  const { data: app } = await supabase
    .from("applications")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!app || (app as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  try {
    await deleteApplicationPrCustomization(id);
  } catch (err) {
    return NextResponse.json(
      { error: "delete_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
