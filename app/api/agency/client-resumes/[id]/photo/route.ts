import { NextResponse } from "next/server";
import sharp from "sharp";

import { requireOrgMember } from "@/lib/api/auth-guards";
import {
  getAgencyClientResume,
  updateAgencyClientResume,
} from "@/lib/agency-client-documents/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * /api/agency/client-resumes/[id]/photo
 *   POST   写真をアップロード(multipart/form-data, field "file")
 *   DELETE 写真を削除
 *
 * 保存先:agency-client-photos バケット
 *   path = {organization_id}/{client_record_id}/{resume_id}.jpg
 *
 * セキュリティ:
 *   ・requireOrgMember(archived ガード込み)+ 履歴書の organization_id 一致確認
 *   ・sharp で再エンコード(SVG / 実行可能フォーマットを混入させない二重防御)
 *   ・Storage RLS でも path 先頭 = organization_id を強制(別組織のパスは弾く)
 *
 * メタ行(agency_client_photos)も同時に upsert する。これにより
 *   「過去にアップロードされた写真の一覧」も保持できる(将来の用途)。
 */

const STORAGE_BUCKET = "agency-client-photos";
const MAX_INPUT_SIZE_BYTES = 5 * 1024 * 1024;
const PHOTO_WIDTH = 450;
const PHOTO_HEIGHT = 600;
const PHOTO_QUALITY = 85;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member, supabase } = guard;

  const { id: resumeId } = await params;
  const resume = await getAgencyClientResume(resumeId, organization.id);
  if (!resume) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file フィールドが必要です" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "対応形式は JPG / PNG / WebP のみです" }, { status: 400 });
  }
  if (file.size > MAX_INPUT_SIZE_BYTES) {
    return NextResponse.json(
      { error: `ファイルサイズは ${MAX_INPUT_SIZE_BYTES / 1024 / 1024}MB 以下にしてください` },
      { status: 400 },
    );
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  let optimized: Buffer;
  let outputMeta: { width: number | undefined; height: number | undefined; bytes: number };
  try {
    optimized = await sharp(inputBuffer)
      .rotate()
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: "cover", position: "top" })
      .jpeg({ quality: PHOTO_QUALITY, progressive: true })
      .toBuffer();
    const meta = await sharp(optimized).metadata();
    outputMeta = { width: meta.width, height: meta.height, bytes: optimized.byteLength };
  } catch {
    return NextResponse.json(
      { error: "画像の処理に失敗しました。別の画像をお試しください" },
      { status: 400 },
    );
  }

  // パスは {org}/{client}/{resume}.jpg(固定)。Storage RLS の path[1] = org_id を満たす。
  const path = `${organization.id}/${resume.clientRecordId}/${resume.id}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, optimized, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: "Storage への保存に失敗しました", message: uploadError.message },
      { status: 500 },
    );
  }

  // 履歴書側に photo_storage_path を反映
  const updateResult = await updateAgencyClientResume({
    id: resume.id,
    organizationId: organization.id,
    photoStoragePath: path,
  });
  if ("error" in updateResult) {
    // ロールバック試行
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    return NextResponse.json(
      { error: "photo_storage_path の更新に失敗しました", message: updateResult.error },
      { status: 500 },
    );
  }

  // メタ行を追加(履歴管理用)。RLS は同組織のみ insert 可。
  // 既存メタは残す(過去アップロード履歴として可視化したくなったとき用)。
  // 失敗してもファイル/path 更新は成功しているので警告のみ。
  try {
    const service = createServiceClient();
    await service.from("agency_client_photos").insert({
      organization_id: organization.id,
      client_record_id: resume.clientRecordId,
      storage_path: path,
      bytes: outputMeta.bytes,
      width: outputMeta.width ?? null,
      height: outputMeta.height ?? null,
      uploaded_by_member_id: member.id,
    });
  } catch (err) {
    console.warn("[agency-client-photos] meta insert failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ photo_storage_path: path });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, supabase } = guard;

  const { id: resumeId } = await params;
  const resume = await getAgencyClientResume(resumeId, organization.id);
  if (!resume) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const path = resume.photoStoragePath;
  if (path) {
    // 既に消えていてもべき等にする(remove は失敗しても無視可能)
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  }

  const updateResult = await updateAgencyClientResume({
    id: resume.id,
    organizationId: organization.id,
    photoStoragePath: null,
  });
  if ("error" in updateResult) {
    return NextResponse.json(
      { error: "photo_storage_path の削除に失敗しました", message: updateResult.error },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
