/**
 * GET  /api/me/google-calendar/events?from=ISO&to=ISO
 * POST /api/me/google-calendar/events
 *
 * GET:本人接続中の Google Primary カレンダーの予定を期間で取得して、
 *      Myaira カレンダー画面に重畳表示するための簡易ビューを返す。
 *
 * POST:Myaira カレンダー画面から「Google に予定を作成」する。
 *
 * 認可:
 *   ・ログイン済みの user 本人
 *   ・google_connections の calendar.events スコープが必須
 *
 * 設計判断:
 *   ・サーバーで Google API を呼んで、レスポンスを Myaira 用の薄い形に整形して返す
 *     → ブラウザに access_token を渡さない(セキュリティ)
 *   ・取得結果は Myaira DB に保存しない(プライバシー懸念回避、毎回 fetch)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import {
  createGoogleCalendarEvent,
  listGoogleCalendarEvents,
  toCalendarEvent,
} from "@/lib/integrations/google-calendar";
import { getGoogleAccessToken } from "@/lib/integrations/google-token";
import { hasCalendarEventsScope } from "@/lib/integrations/google";
import type { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const querySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

const createSchema = z.object({
  summary: z.string().min(1).max(200),
  description: z.string().max(8000).optional().or(z.literal("")),
  location: z.string().max(500).optional().or(z.literal("")),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  timezone: z.string().optional(),
  attendees: z
    .array(z.object({ email: z.string().email(), name: z.string().optional() }))
    .max(50)
    .optional(),
});

/**
 * 接続状態 + スコープ確認の共通ヘルパ。
 * - "no_connection" : google_connections 未登録(接続してください)
 * - "no_scope"      : calendar.events 未認可(再接続してください)
 * - "ok"            : OK
 */
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

export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const status = await ensureCalendarConnection(supabase, user.id);
  if (status === "no_connection") {
    return NextResponse.json({ events: [], notConnected: true });
  }
  if (status === "no_scope") {
    return NextResponse.json({ events: [], scopeInsufficient: true });
  }

  // service_role でトークンを取得(refresh + 暗号化更新)
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
    const list = await listGoogleCalendarEvents(accessToken, {
      timeMin: parsed.data.from,
      timeMax: parsed.data.to,
    });
    const events = list.map(toCalendarEvent).filter((e): e is NonNullable<typeof e> => e !== null);
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      { error: "list_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = createSchema.safeParse(bodyResult.body);
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
    const created = await createGoogleCalendarEvent(accessToken, parsed.data);
    if (!created) {
      return NextResponse.json({ error: "create_returned_empty" }, { status: 502 });
    }
    const view = toCalendarEvent(created);
    return NextResponse.json({ event: view, raw: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "create_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 502 },
    );
  }
}
