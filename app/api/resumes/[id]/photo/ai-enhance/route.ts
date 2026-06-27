import { NextResponse } from "next/server";
import sharp from "sharp";

import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { aiEnhanceSelfie } from "@/lib/photos/ai-enhance";
import { createClient } from "@/lib/supabase/server";
import { verifyResumeOwner } from "@/lib/resumes/queries";

/**
 * POST /api/resumes/[id]/photo/ai-enhance
 *
 * スマホ自撮り → OpenAI gpt-image-1 で証明写真化 → sharp で 450x600 整形 →
 * **JPEG レスポンス本体としてそのまま返す**(Storage に保存しない)。
 *
 * クライアントは Before/After モーダルで AI 出力をプレビューし、
 * ユーザが「この写真で保存」を押したら通常の POST /api/resumes/[id]/photo に
 * 同じ Blob を投げて保存する。
 *
 * このフローにより:
 *   ・AI が顔を別人に変換してしまうケースなどで「保存前に止める」ことができる
 *   ・既存の photo 保存パスを 1 本に保てる(整合性が崩れない)
 *
 * 入力:multipart/form-data の "file"(JPG/PNG、5 MB 以下)
 * 出力:image/jpeg バイナリ(450x600、progressive、最終保存形式と同じ)
 *
 * 注意:
 *   ・元画像は AI 処理用に OpenAI に送られる(プライバシーポリシー第 5 条のAI処理範囲)
 *   ・サーバ側には永続化しない(本ルートでは Storage 書込なし)
 *   ・コストは 1 枚あたり ~$0.07(quality=medium)
 */

// 画像生成は 30-60 秒 かかる ことが ある ため、 Vercel デフォルト (10 秒) を 延長。
export const maxDuration = 300;

const MAX_INPUT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const PHOTO_WIDTH = 450;
const PHOTO_HEIGHT = 600;
const PHOTO_QUALITY = 85;

type RouteParams = { params: Promise<{ id: string }> };

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

  // 月次クォータチェック(OpenAI コストが線形に効くため、AI 呼出前に弾く)
  const usage = await checkAiUsageLimit(supabase, user.id, "photo_enhance");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "ai_quota_exceeded",
        message: usage.addon
          ? `今月の AI 証明写真の上限(${usage.limit} 回)に達しました。`
          : `今月の AI 証明写真の上限(${usage.limit} 回)に達しました。アドオン契約で上限が拡張されます。`,
        usage: {
          current: usage.current,
          limit: usage.limit,
          addon: usage.addon,
          resetsAt: usage.resetsAt,
        },
      },
      { status: 402 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file フィールドが必要です" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "対応形式は JPG / PNG のみです" }, { status: 400 });
  }
  if (file.size > MAX_INPUT_SIZE_BYTES) {
    return NextResponse.json(
      { error: `ファイルサイズは ${MAX_INPUT_SIZE_BYTES / 1024 / 1024}MB 以下にしてください` },
      { status: 400 },
    );
  }

  // 1) AI 仕上げ
  const ai = await aiEnhanceSelfie({ imageBlob: file, filename: "selfie.png" });
  if (!ai.ok) {
    const status = ai.reason === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: ai.reason, message: ai.message }, { status });
  }

  // 2) sharp で 450x600 に正規化(既存写真フローと完全に同じ最終フォーマット)
  let optimized: Buffer;
  try {
    optimized = await sharp(ai.pngBuffer)
      .rotate()
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: "cover", position: "top" })
      .jpeg({ quality: PHOTO_QUALITY, progressive: true })
      .toBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "sharp_failed", message: msg }, { status: 500 });
  }

  // 3) AI 呼出が成功したのでクォータ消費を記録
  //    Before/After 比較でユーザがキャンセルしても、すでに OpenAI コストは発生しているのでカウント
  await recordAiUsage(supabase, user.id, "photo_enhance", { resumeId: id });

  // 4) 保存はせず、JPEG バイナリをそのまま返す。
  //    クライアントが Before/After プレビューで承認した場合のみ、
  //    通常の POST /api/resumes/[id]/photo に同じ Blob を投げて保存する。
  return new NextResponse(new Uint8Array(optimized), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
