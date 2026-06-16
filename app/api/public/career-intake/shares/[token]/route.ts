import { NextResponse } from "next/server";

import { decryptField } from "@/lib/crypto/field-encryption";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/public/career-intake/shares/[token]
 *
 * 公開エンドポイント。認証なしで token に紐付く抽出結果を返す。
 * - token 形式不正 → 400
 * - 見つからない / 失効済み / 期限切れ → 404 / 410
 * - 正常 → 抽出 JSON(+ 公開用メタ情報のみ)
 *
 * 個人特定情報(氏名 / 住所など)は元から抽出していないので、公開してもリスク低。
 * 抽出 JSON のうち nameKana / birthDate は念のため伏せる。
 */
type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: shareRow } = await service
    .from("career_intake_shares")
    .select("id, recording_id, expires_at, revoked_at, label, created_at")
    .eq("token", token)
    .maybeSingle();

  if (!shareRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const share = shareRow as {
    id: string;
    recording_id: string;
    expires_at: string;
    revoked_at: string | null;
    label: string | null;
    created_at: string;
  };
  if (share.revoked_at) {
    return NextResponse.json({ error: "Revoked" }, { status: 410 });
  }
  if (new Date(share.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  // 録音から抽出 JSON を取得して復号
  const { data: recRow } = await service
    .from("career_intake_recordings")
    .select("status, encrypted_extraction, original_filename")
    .eq("id", share.recording_id)
    .maybeSingle();
  if (!recRow) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }
  const rec = recRow as {
    status: string;
    encrypted_extraction: string | null;
    original_filename: string;
  };
  if (rec.status !== "extracted" || !rec.encrypted_extraction) {
    return NextResponse.json({ error: "Extraction not ready" }, { status: 409 });
  }

  const decrypted = await decryptField(rec.encrypted_extraction);
  if (!decrypted) {
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decrypted);
  } catch {
    return NextResponse.json({ error: "Malformed extraction" }, { status: 500 });
  }
  const validated = extractionResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    return NextResponse.json({ error: "Invalid extraction" }, { status: 500 });
  }

  // 念のため伏せる項目(氏名カナ / 生年月日)を null 化
  const safe = {
    ...validated.data,
    nameKana: null,
    birthDate: null,
  };

  return NextResponse.json({
    label: share.label,
    expiresAt: share.expires_at,
    createdAt: share.created_at,
    recordingFilename: rec.original_filename,
    extraction: safe,
  });
}
