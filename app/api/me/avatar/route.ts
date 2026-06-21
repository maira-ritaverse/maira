import { NextResponse } from "next/server";

import { buildAvatarStoragePath } from "@/lib/profile/avatar";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/me/avatar (multipart/form-data, field "file")
 *   ・自分 の アバター 画像 を アップロード し profiles.avatar_storage_path を 更新
 *   ・JPEG / PNG / WebP のみ、 2 MiB 以下
 *   ・既存 画像 が あれ ば 上書き 削除 (新 path は epoch ms 付き で 別 ファイル)
 *
 * DELETE /api/me/avatar
 *   ・アバター を 削除 し profiles.avatar_storage_path を NULL に
 */

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = "avatar-images";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      { error: "file_too_large", message: "2 MiB 以下 の 画像 に して ください" },
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

  // 既存 アバター の Storage パス を 取得 (上書き 削除 用)
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("avatar_storage_path")
    .eq("id", user.id)
    .maybeSingle();
  const oldPath =
    (profileRow as { avatar_storage_path: string | null } | null)?.avatar_storage_path ?? null;

  // Storage アップロード は user 認証 client で 可 (RLS で 自分 フォルダ に
  // 限定)。 簡単 化 の ため service_role で 上げる。
  const admin = createServiceClient();
  const newPath = buildAvatarStoragePath(user.id, mime, Date.now());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(newPath, file, {
    contentType: mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (upErr) {
    return NextResponse.json({ error: "upload_failed", message: upErr.message }, { status: 500 });
  }

  // profiles の path を 更新 (RLS で 自分 行 のみ)
  const { error: updErr } = await supabase
    .from("profiles")
    .update({ avatar_storage_path: newPath })
    .eq("id", user.id);
  if (updErr) {
    // ロールバック: 上げた オブジェクト を 消す
    void admin.storage.from(BUCKET).remove([newPath]);
    return NextResponse.json(
      { error: "db_update_failed", message: updErr.message },
      { status: 500 },
    );
  }

  // 旧 オブジェクト 削除 (失敗 して も path 更新 は 既に 済 で 致命的 でない)
  if (oldPath) {
    void admin.storage.from(BUCKET).remove([oldPath]);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(newPath);
  return NextResponse.json({ ok: true, path: newPath, publicUrl: pub.publicUrl });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("avatar_storage_path")
    .eq("id", user.id)
    .maybeSingle();
  const oldPath =
    (profileRow as { avatar_storage_path: string | null } | null)?.avatar_storage_path ?? null;

  const { error: updErr } = await supabase
    .from("profiles")
    .update({ avatar_storage_path: null })
    .eq("id", user.id);
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
