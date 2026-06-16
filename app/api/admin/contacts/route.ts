import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/contacts?filter=unread|all
 *
 * 運営者用:問い合わせ受信箱の一覧。
 *
 * - unread:read_at IS NULL のみ
 * - all   :全件(直近 200 件)
 *
 * RLS でも運営者限定だが、isMairaAdmin() でも二重ガード。
 */
type Row = {
  id: string;
  company: string;
  name: string;
  email: string;
  message: string;
  ip_address: string | null;
  user_agent: string | null;
  read_at: string | null;
  notes: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  const qRaw = url.searchParams.get("q")?.trim() ?? "";
  // 検索キーワードは ilike にそのまま渡せないメタ文字(% / _)をエスケープ
  const qEscaped = qRaw.replace(/([\\%_])/g, "\\$1");

  const admin = createServiceClient();
  let query = admin
    .from("contact_messages")
    .select("id, company, name, email, message, ip_address, user_agent, read_at, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter === "unread") {
    query = query.is("read_at", null);
  }
  if (qEscaped.length > 0) {
    // company / name / email / message のいずれかに含まれる(部分一致)
    const pattern = `%${qEscaped}%`;
    query = query.or(
      `company.ilike.${pattern},name.ilike.${pattern},email.ilike.${pattern},message.ilike.${pattern}`,
    );
  }
  // category クエリ:DB に列は無いので、API 側のプレフィックス判定を
  // 逆変換した ilike で絞り込む(MVP 規模では十分な性能)。
  if (category === "signup_inquiry") {
    query = query.ilike("message", "[新規導入のお問い合わせ]%");
  } else if (category === "general") {
    query = query.not("message", "ilike", "[新規導入のお問い合わせ]%");
  }
  // status クエリ:運営メモ先頭の [対応中] プレフィックスで簡易ステータス化
  // (テーブルに列追加しない軽量実装)
  if (status === "in_progress") {
    query = query.ilike("notes", "[対応中]%");
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed", message: error.message }, { status: 500 });
  }
  const messages = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    company: r.company,
    name: r.name,
    email: r.email,
    message: r.message,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    readAt: r.read_at,
    notes: r.notes,
    createdAt: r.created_at,
    // 新規導入フォームから来た問い合わせは message 先頭にプレフィックスが付く
    // (components/features/auth/signup-inquiry-form.tsx)。これで運営が
    // 「リード(契約候補)」と「一般質問」を即時に見分けられる。
    category: categorize(r.message),
    // 簡易ステータス:notes の先頭が [対応中] なら in_progress 扱い。
    // 列追加しない MVP 実装。将来正式ステータス列を切るなら移行。
    statusLabel: (r.notes ?? "").startsWith("[対応中]")
      ? ("in_progress" as const)
      : ("open" as const),
  }));

  // 未読件数(バッジ等で使えるよう常に返す)
  const { count: unreadCount } = await admin
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return NextResponse.json({
    messages,
    total: messages.length,
    unreadCount: unreadCount ?? 0,
  });
}

/**
 * PATCH /api/admin/contacts
 *
 * Body: { id: string, readAt?: "now" | null, notes?: string }
 *
 * - readAt="now"  → read_at を現在時刻に
 * - readAt=null   → 未読に戻す
 * - notes         → 自由メモ更新
 *
 * 既読化とメモ更新を 1 ルートに集約(複雑度を抑えるため)。
 */
/** 問い合わせ本文の先頭プレフィックスから種別を判定。 */
function categorize(message: string): "signup_inquiry" | "general" {
  if (message.startsWith("[新規導入のお問い合わせ]")) return "signup_inquiry";
  return "general";
}

export async function PATCH(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as { id?: string; readAt?: "now" | null; notes?: string };
  if (!b.id || typeof b.id !== "string") {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (b.readAt === "now") updates.read_at = new Date().toISOString();
  if (b.readAt === null) updates.read_at = null;
  if (typeof b.notes === "string") updates.notes = b.notes;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no_updates" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error } = await admin.from("contact_messages").update(updates).eq("id", b.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
