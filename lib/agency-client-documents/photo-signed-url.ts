/**
 * agency-client-photos バケットの署名 URL 発行ヘルパー。
 *
 * seeker 履歴書写真と分けた理由:
 *   ・seeker 履歴書写真は本人のセッションでのみ署名 URL が発行できる
 *   ・本バケットは組織配下に絞ったポリシー(パス先頭 = organization_id)で
 *     発行可能。エージェント本人がログイン中のセッションで呼ぶ。
 */
import { createClient } from "@/lib/supabase/server";

const BUCKET = "agency-client-photos";

export const AGENCY_PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC = 60 * 60; // 1h
export const AGENCY_PHOTO_SIGNED_URL_PDF_EXPIRES_SEC = 5 * 60; // 5min

export async function createAgencyClientPhotoSignedUrl(
  storagePath: string,
  expiresInSec: number,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
