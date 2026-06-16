/**
 * PATCH  /api/me/google-calendar/events/[id]
 * DELETE /api/me/google-calendar/events/[id]
 *
 * 本人接続中の Google Primary カレンダーの 1 件を編集 / 削除する。
 *
 * 認可:
 *   ・ログイン済みの user 本人
 *   ・google_connections の calendar.events スコープが必須
 *
 * 削除は sendUpdates=none(招待者通知なし)で、Google 側のみの操作で完結。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import {
  deleteGoogleCalendarEvent,
  toCalendarEvent,
  updateGoogleCalendarEvent,
} from "@/lib/integrations/google-calendar";
import { getGoogleAccessToken } from "@/lib/integrations/google-token";
import { hasCalendarEventsScope } from "@/lib/integrations/google";
import type { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const patchSchema = z.object({
  summary: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  location: z.string().max(500).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function ensureCalendarConnection(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<"ok" | "no_connection" | "no_scope"> {
  const { data: conn } = await supabase
    .from("google_connections")
    .select("user_id, scope, scopes_granted")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return "no_connection";
  const scopeOk =
    hasCalendarEventsScope((conn as { scope: string | null }).scope) ||
    ((conn as { scopes_granted: string[] | null }).scopes_granted ?? []).includes(
      "https://www.googleapis.com/auth/calendar.events",
    );
  return scopeOk ? "ok" : "no_scope";
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;
  const { id } = await context.params;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = patchSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const status = await ensureCalendarConnection(supabase, user.id);
  if (status === "no_connection") {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }
  if (status === "no_scope") {
    return NextResponse.json({ error: "scope_insufficient" }, { status: 409 });
  }

  const service = createServiceClient();
  let accessToken: string;
  try {
    const ctx = await getGoogleAccessToken({ service, userId: user.id });
    accessToken = ctx.accessToken;
  } catch (err) {
    return NextResponse.json(
      { error: "token_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 502 },
    );
  }

  try {
    const updated = await updateGoogleCalendarEvent(accessToken, id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "update_returned_empty" }, { status: 502 });
    }
    const view = toCalendarEvent(updated);
    return NextResponse.json({ event: view });
  } catch (err) {
    return NextResponse.json(
      { error: "update_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 502 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;
  const { id } = await context.params;

  const status = await ensureCalendarConnection(supabase, user.id);
  if (status === "no_connection") {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }
  if (status === "no_scope") {
    return NextResponse.json({ error: "scope_insufficient" }, { status: 409 });
  }

  const service = createServiceClient();
  let accessToken: string;
  try {
    const ctx = await getGoogleAccessToken({ service, userId: user.id });
    accessToken = ctx.accessToken;
  } catch (err) {
    return NextResponse.json(
      { error: "token_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 502 },
    );
  }

  try {
    await deleteGoogleCalendarEvent(accessToken, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: "delete_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 502 },
    );
  }
}
