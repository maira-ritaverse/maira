import { NextResponse } from "next/server";
import sharp from "sharp";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getAgencyClientResume } from "@/lib/agency-client-documents/queries";
import { aiEnhanceSelfie } from "@/lib/photos/ai-enhance";

/**
 * POST /api/agency/client-resumes/[id]/photo/ai-enhance
 *
 * エージェントが「自撮り風」のスマホ画像を OpenAI gpt-image-1 で証明写真に
 * 変換し、JPEG バイナリ(450×600)としてその場で返す。
 *
 * 設計判断:
 *   ・seeker 側 /api/resumes/[id]/photo/ai-enhance と同じ パターンを採用。
 *     ストレージには保存せず、ユーザが「この写真で保存」を押した時のみ
 *     通常の POST .../photo に同じ Blob を投げて保存する 2 段階構造。
 *   ・AI Usage クォータは seeker 月次フローを再利用せず、エージェント側は
 *     当面ノーチャージで提供(運用 OK / 課題発生時は ai_usage_events に
 *     organization_id 軸の集計を追加する将来拡張)。
 *   ・OpenAI コストはエージェント企業の運用責任。本来は org クォータを設けたい。
 *
 * 入力:multipart/form-data の "file"(JPG/PNG、5 MB 以下)
 * 出力:image/jpeg バイナリ(450×600、progressive)
 *
 * 注意:
 *   ・元画像は OpenAI に送られる(プライバシーポリシー第 5 条の AI 処理範囲)
 *   ・サーバ側に永続化しない(本ルートは Storage を一切触らない)
 *   ・本ルートでは履歴書本体は変更しない。保存は別ルート(/photo の POST)。
 */

const MAX_INPUT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const PHOTO_WIDTH = 450;
const PHOTO_HEIGHT = 600;
const PHOTO_QUALITY = 85;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const { id: resumeId } = await params;
  const resume = await getAgencyClientResume(resumeId, organization.id);
  if (!resume) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // multipart の file を取り出す
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
    return NextResponse.json({ error: "対応形式は JPG / PNG のみです" }, { status: 400 });
  }
  if (file.size > MAX_INPUT_SIZE_BYTES) {
    return NextResponse.json(
      { error: `ファイルサイズは ${MAX_INPUT_SIZE_BYTES / 1024 / 1024}MB 以下にしてください` },
      { status: 400 },
    );
  }

  // 1) AI 仕上げ(quality=medium 固定:コストと品質のバランス)
  const ai = await aiEnhanceSelfie({ imageBlob: file, filename: "selfie.png" });
  if (!ai.ok) {
    const status = ai.reason === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: ai.reason, message: ai.message }, { status });
  }

  // 2) sharp で 450×600 に正規化(seeker と同じ最終フォーマット)
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

  // 3) JPEG バイナリで返す。承認後に通常の保存 API に同じ Blob を投げる。
  return new NextResponse(new Uint8Array(optimized), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
