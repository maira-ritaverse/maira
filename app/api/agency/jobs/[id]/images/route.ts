import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import type { JobImageKind } from "@/lib/jobs/types";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST   /api/agency/jobs/[id]/images?kind=hero|line_share
 *   multipart/form-data の field "file" を 受け取り、 job-images バケット に 保存。
 *   既存 画像 が あれば 上書き 削除 してから 新しい パス を job_postings に 保存。
 *
 * DELETE /api/agency/jobs/[id]/images?kind=hero|line_share
 *   現 画像 を Storage から 削除 + job_postings の 列 を NULL に。
 */
const ALLOWED_KINDS: JobImageKind[] = ["hero", "line_share"];
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "job-images";

type Params = { params: Promise<{ id: string }> };

function pickKind(url: URL): JobImageKind | null {
  const raw = url.searchParams.get("kind");
  if (raw === "hero" || raw === "line_share") return raw;
  return null;
}

function columnForKind(kind: JobImageKind): "hero_image_path" | "line_share_image_path" {
  return kind === "hero" ? "hero_image_path" : "line_share_image_path";
}

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function POST(request: Request, ctx: Params) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { id: jobId } = await ctx.params;

  const url = new URL(request.url);
  const kind = pickKind(url);
  if (!kind) {
    return NextResponse.json(
      { error: "invalid_kind", message: `kind は ${ALLOWED_KINDS.join(", ")} のいずれか` },
      { status: 400 },
    );
  }

  // 求人 が 自組織 の もの か 確認 (RLS と 二重 防御)
  const { data: jobRow } = await guard.supabase
    .from("job_postings")
    .select("id, organization_id, hero_image_path, line_share_image_path")
    .eq("id", jobId)
    .maybeSingle();
  type JobRow = {
    id: string;
    organization_id: string;
    hero_image_path: string | null;
    line_share_image_path: string | null;
  };
  const job = jobRow as JobRow | null;
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.organization_id !== guard.organization.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // multipart 取得
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
      { error: "file_too_large", message: `5 MiB 以内 の 画像 に して ください` },
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

  const ext = extForMime(mime);
  // 既存 path が ある なら 削除 (上書き しても OK だ が、 拡張子 違い の 残骸 を 防ぐ)
  const column = columnForKind(kind);
  const oldPath = kind === "hero" ? job.hero_image_path : job.line_share_image_path;
  const newPath = `${guard.organization.id}/${jobId}/${kind}-${Date.now()}.${ext}`;

  // Storage アップロード は service_role で 行う (パス が org スコープ で
  // RLS は 効く が、 service_role の 方 が シンプル かつ atomic)
  const admin = createServiceClient();
  const { error: upErr } = await admin.storage.from(BUCKET).upload(newPath, file, {
    contentType: mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (upErr) {
    return NextResponse.json({ error: "upload_failed", message: upErr.message }, { status: 500 });
  }

  // 旧 オブジェクト を 削除 (失敗 して も path 更新 は 続行)
  if (oldPath) {
    void admin.storage.from(BUCKET).remove([oldPath]);
  }

  // job_postings の 列 を 更新
  const { error: updErr } = await guard.supabase
    .from("job_postings")
    .update({ [column]: newPath })
    .eq("id", jobId);
  if (updErr) {
    // ロールバック: 上げた オブジェクト を 消す
    void admin.storage.from(BUCKET).remove([newPath]);
    return NextResponse.json(
      { error: "db_update_failed", message: updErr.message },
      { status: 500 },
    );
  }

  // public URL を 返す (UI で 即時 プレビュー 用)
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(newPath);
  return NextResponse.json({ ok: true, path: newPath, publicUrl: pub.publicUrl });
}

export async function DELETE(request: Request, ctx: Params) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { id: jobId } = await ctx.params;

  const url = new URL(request.url);
  const kind = pickKind(url);
  if (!kind) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  const column = columnForKind(kind);

  const { data: jobRow } = await guard.supabase
    .from("job_postings")
    .select("id, organization_id, hero_image_path, line_share_image_path")
    .eq("id", jobId)
    .maybeSingle();
  type JobRow = {
    id: string;
    organization_id: string;
    hero_image_path: string | null;
    line_share_image_path: string | null;
  };
  const job = jobRow as JobRow | null;
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.organization_id !== guard.organization.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const current = kind === "hero" ? job.hero_image_path : job.line_share_image_path;
  if (!current) {
    return NextResponse.json({ ok: true, path: null });
  }
  const admin = createServiceClient();
  void admin.storage.from(BUCKET).remove([current]);
  const { error: updErr } = await guard.supabase
    .from("job_postings")
    .update({ [column]: null })
    .eq("id", jobId);
  if (updErr) {
    return NextResponse.json(
      { error: "db_update_failed", message: updErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, path: null });
}
