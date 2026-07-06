import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/user-links/[lineUserId]/create-client
 *
 * LINE 友達 を 元 に 新規 CRM 顧客 (client_records) を 作成 して、
 * line_user_links.client_record_id に 紐付ける。
 *
 * トリガー:
 *   ・LINE 友達 追加 時 に display_name の 完全 一致 で 自動 マッチ しなかった 場合、
 *     admin/advisor が UI から 「CRM に 追加」 ボタン で 手動 で 起こす。
 *
 * 挙動:
 *   ・LINE display_name / picture を 初期値 と し て 新規 client_records を 作成
 *   ・任意 で name / kana / note を 上書き 可能 (body で 渡せる)
 *   ・既に line_user_links.client_record_id が セット されて いる 場合 は 409
 *   ・作成 後 に line_user_links に 反映 (link_method = 'manual')
 *
 * 認可: requireOrgMember。 organization_id を コード で 縛る (RLS 二重 防御)。
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lineUserId: string }> };

const bodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  nameKana: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const { lineUserId: raw } = await context.params;
  const lineUserId = decodeURIComponent(raw);

  const jsonResult = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(jsonResult ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // 対象 の line_user_links を 取得 + 既に client_record が 紐付いて い ない か 確認
  const { data: linkRow, error: linkErr } = await admin
    .from("line_user_links")
    .select("id, display_name, custom_name, picture_url, client_record_id")
    .eq("organization_id", organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (linkErr) {
    return NextResponse.json(
      { error: "line_link_fetch_failed", message: linkErr.message },
      { status: 500 },
    );
  }
  if (!linkRow) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }
  const link = linkRow as {
    id: string;
    display_name: string | null;
    custom_name: string | null;
    picture_url: string | null;
    client_record_id: string | null;
  };
  if (link.client_record_id) {
    return NextResponse.json(
      { error: "already_linked", message: "すでに CRM 顧客 に 連携 されて います。" },
      { status: 409 },
    );
  }

  // 初期値: body 指定 > custom_name > display_name > "LINE 友達"
  const name =
    parsed.data.name?.trim() ||
    link.custom_name?.trim() ||
    link.display_name?.trim() ||
    "LINE 友達";

  // client_records.email は NOT NULL の た め、 LINE 友達 由来 の 顧客 は
  // ドメイン @line.local の 仮 email を セット (admin が 後で 実 メール で 上書き)。
  // 実 メール で ない こと が 一目 で 分かる 表記 に する。
  const placeholderEmail = `line_${lineUserId.slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}@line.local`;

  // 顧客 作成 (name + email + 組織 が 必須)
  const { data: clientRow, error: clientErr } = await admin
    .from("client_records")
    .insert({
      organization_id: organization.id,
      name,
      name_kana: parsed.data.nameKana?.trim() || null,
      email: placeholderEmail,
    })
    .select("id, name")
    .single();

  if (clientErr || !clientRow) {
    return NextResponse.json(
      { error: "client_create_failed", message: clientErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const newClient = clientRow as { id: string; name: string };

  // line_user_links に 紐付け
  const { error: linkUpdateErr } = await admin
    .from("line_user_links")
    .update({
      client_record_id: newClient.id,
      linked_at: new Date().toISOString(),
      link_method: "manual",
    })
    .eq("organization_id", organization.id)
    .eq("line_user_id", lineUserId);

  if (linkUpdateErr) {
    // ロールバック: 顧客 作成 は 成功 した が リンク で 失敗 した 場合、
    // 顧客 だけ が 孤児 で 残る と 「同名 顧客 が 増える → 自動 マッチ が 沈黙 停止」
    // する ので best-effort で 削除 する。 削除 失敗 は log のみ (2 次 障害 を 隠さない)。
    const { error: deleteErr } = await admin
      .from("client_records")
      .delete()
      .eq("id", newClient.id)
      .eq("organization_id", organization.id);
    if (deleteErr) {
      console.error(
        `[create-client] orphan cleanup failed for ${newClient.id}: ${deleteErr.message}`,
      );
    }
    return NextResponse.json(
      {
        error: "link_update_failed",
        message: linkUpdateErr.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      clientRecord: { id: newClient.id, name: newClient.name },
      lineUserId,
    },
    { status: 201 },
  );
}
