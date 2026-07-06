import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/settings/line-intro/photo (multipart/form-data, field "file")
 *   ・自分 の LINE 自己 紹介 用 顔 写真 を アップロード
 *   ・avatar-images バケット の line-intro/{org_id}/{user_id}/{ts}.jpg に 保存
 *   ・DB (organization_members.line_intro_photo_storage_path) に パス を セット
 *
 * DELETE /api/agency/settings/line-intro/photo
 *   ・写真 を 削除
 */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
// バケット 上限 も 5 MiB に 引き 上げ 済 (migration 20260706000005)。
// 顔 写真 は 元 画像 が 5〜6 MB の こと が 多い の で 実運用 に 合わせる。
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "avatar-images";

export const dynamic = "force-dynamic";

function buildPath(orgId: string, userId: string, mime: string, ts: number): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `line-intro/${orgId}/${userId}/${ts}.${ext}`;
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", message: "5 MiB 以下 の 画像 に して ください" },
      { status: 413 },
    );
  }
  const mime = file.type || "image/jpeg";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "invalid_mime", message: "JPEG / PNG / WebP の いずれか" },
      { status: 415 },
    );
  }

  // 既存 画像 の パス を 取得 (差 し 替え 削除 用)
  const { data: memberRow } = await supabase
    .from("organization_members")
    .select("line_intro_photo_storage_path")
    .eq("user_id", user.id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  const oldPath =
    (memberRow as { line_intro_photo_storage_path: string | null } | null)
      ?.line_intro_photo_storage_path ?? null;

  const admin = createServiceClient();
  const newPath = buildPath(organization.id, user.id, mime, Date.now());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(newPath, file, {
    contentType: mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (upErr) {
    return NextResponse.json({ error: "upload_failed", message: upErr.message }, { status: 500 });
  }

  const { error: updErr } = await supabase
    .from("organization_members")
    .update({
      line_intro_photo_storage_path: newPath,
      line_intro_updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("organization_id", organization.id);
  if (updErr) {
    // ロールバック
    void admin.storage.from(BUCKET).remove([newPath]);
    return NextResponse.json(
      { error: "db_update_failed", message: updErr.message },
      { status: 500 },
    );
  }

  if (oldPath) {
    void admin.storage.from(BUCKET).remove([oldPath]);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(newPath);
  return NextResponse.json({ ok: true, path: newPath, publicUrl: pub.publicUrl });
}

export async function DELETE() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;

  const { data: memberRow } = await supabase
    .from("organization_members")
    .select("line_intro_photo_storage_path")
    .eq("user_id", user.id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  const oldPath =
    (memberRow as { line_intro_photo_storage_path: string | null } | null)
      ?.line_intro_photo_storage_path ?? null;

  const { error: updErr } = await supabase
    .from("organization_members")
    .update({
      line_intro_photo_storage_path: null,
      line_intro_updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("organization_id", organization.id);
  if (updErr) {
    return NextResponse.json(
      { error: "db_update_failed", message: updErr.message },
      { status: 500 },
    );
  }
  if (oldPath) {
    const admin = createServiceClient();
    void admin.storage.from(BUCKET).remove([oldPath]);
  }
  return NextResponse.json({ ok: true });
}
