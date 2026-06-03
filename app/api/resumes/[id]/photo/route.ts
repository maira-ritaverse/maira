import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { updateResumePhotoPath, verifyResumeOwner } from "@/lib/resumes/queries";

/**
 * 履歴書 写真 アップロード / 削除 API
 *
 * POST   /api/resumes/[id]/photo  写真をアップロード(multipart/form-data, field name: "file")
 * DELETE /api/resumes/[id]/photo  写真を削除
 *
 * セキュリティ:
 *   - 本人(auth.uid())のみ。verifyResumeOwner で resume の所有者を明示確認。
 *   - Storage 側も RLS で本人のみ書き込み可だが、API 層でも防御的に弾く。
 *   - sharp で受け取った画像を再エンコードするため、SVG など実行可能フォーマットを
 *     入れられても出力は jpeg バイナリに正規化される(XSS 対策の二重防御)。
 *
 * パス構造:
 *   resume-photos/{user_id}/{resume_id}/photo.jpg
 *   - 固定ファイル名でアップロード(upsert=true)。
 *     旧ファイルは自動上書きされるため、明示削除は不要。
 *   - photo_url(encrypted_pii)には、このパスだけを格納する。
 *     表示・PDF 時は、サーバー側で署名付きURLを都度発行する(S3 で実装)。
 */

const STORAGE_BUCKET = "resume-photos";
const PHOTO_FILENAME = "photo.jpg";

// 入力ファイルの上限(5MB)。スマホ写真の実用域上限。
const MAX_INPUT_SIZE_BYTES = 5 * 1024 * 1024;

// 履歴書証明写真の標準的なアスペクト比(縦長 3:4)。
// 450x600 は印刷 300dpi 換算で約 38x51mm ≒ JIS 履歴書写真 30x40mm を上回るため、
// プレビュー・PDF 双方で破綻しない。
const PHOTO_WIDTH = 450;
const PHOTO_HEIGHT = 600;
const PHOTO_QUALITY = 85;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isOwner = await verifyResumeOwner(id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // multipart/form-data の "file" を取り出す
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

  // 形式チェック(クライアント Content-Type を信用しすぎないよう、sharp の自動判定でも
  // 結果的に jpeg に強制再エンコードされる二重防御)
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "対応形式は JPG / PNG のみです" }, { status: 400 });
  }
  if (file.size > MAX_INPUT_SIZE_BYTES) {
    return NextResponse.json(
      { error: `ファイルサイズは ${MAX_INPUT_SIZE_BYTES / 1024 / 1024}MB 以下にしてください` },
      { status: 400 },
    );
  }

  // sharp で最適化
  // - rotate() で EXIF Orientation を尊重(スマホ縦撮影が横倒しになる事故を防ぐ)
  // - cover + top で上揃え(顔が中央〜上に来やすい証明写真用)
  // - progressive JPEG でブラウザの段階表示を効かせる
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  let optimized: Buffer;
  try {
    optimized = await sharp(inputBuffer)
      .rotate()
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: "cover", position: "top" })
      .jpeg({ quality: PHOTO_QUALITY, progressive: true })
      .toBuffer();
  } catch {
    return NextResponse.json(
      { error: "画像の処理に失敗しました。別の画像をお試しください" },
      { status: 400 },
    );
  }

  // Storage へ書き込み(本人のセッション → RLS が効く)
  const path = `${user.id}/${id}/${PHOTO_FILENAME}`;
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

  // encrypted_pii に photo_url(= Storage パス)を反映
  try {
    await updateResumePhotoPath(id, user.id, path);
  } catch (error) {
    // DB 更新失敗時は Storage 側もロールバック試行する(整合性のため)。
    // remove は失敗しても致命的ではないので結果は無視する。
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    return NextResponse.json(
      {
        error: "photo_url の保存に失敗しました",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ photo_url: path });
}

export async function DELETE(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isOwner = await verifyResumeOwner(id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Storage から削除。既に無い場合のエラーは握りつぶす(べき等にしたい)。
  const path = `${user.id}/${id}/${PHOTO_FILENAME}`;
  await supabase.storage.from(STORAGE_BUCKET).remove([path]);

  // encrypted_pii から photo_url を消す
  try {
    await updateResumePhotoPath(id, user.id, null);
  } catch (error) {
    return NextResponse.json(
      {
        error: "photo_url の削除に失敗しました",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
