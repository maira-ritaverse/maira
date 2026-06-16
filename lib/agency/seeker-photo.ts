/**
 * エージェント視点で linked クライアントの「最新の証明写真」を取得するヘルパ。
 *
 * - 認可:既存 RLS(`Org members can view linked client resumes`)で、
 *   linked / 期限内 revoke_requested の resume を SELECT 可能
 * - 取得対象は最新の updated_at の resume(複数あっても 1 枚で十分)
 * - photo_url(Storage パス)があれば 60 分有効の署名 URL を発行して返す
 */
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";

const STORAGE_BUCKET = "resume-photos";
const SIGNED_URL_EXPIRE_SEC = 60 * 60; // 60 分

export type SeekerPhotoInfo = {
  /** 表示用署名 URL(60 分有効) */
  signedUrl: string;
  /** Storage パス(デバッグ用) */
  storagePath: string;
  /** どの履歴書の写真か(最新の resume.id) */
  resumeId: string;
  resumeTitle: string;
  /** 履歴書が最後に更新された時刻 */
  resumeUpdatedAt: string;
};

/**
 * linked クライアント本人(linkedUserId)が登録している履歴書のうち、
 * 最新の写真付きのものを 1 枚返す。
 *
 * 戻り値:
 *   - 写真があれば SeekerPhotoInfo
 *   - 履歴書なし / 写真なし / 署名 URL 失敗時は null(UI で「未登録」と扱う)
 */
export async function getLinkedSeekerLatestPhoto(
  linkedUserId: string,
): Promise<SeekerPhotoInfo | null> {
  const supabase = await createClient();
  let resumes;
  try {
    resumes = await listResumes(linkedUserId);
  } catch {
    return null;
  }
  if (resumes.length === 0) return null;

  // 写真ありを優先して updated_at 降順から探す(listResumes は updated_at desc 想定)
  const withPhoto = resumes.find((r) => r.photoUrl && r.photoUrl.trim() !== "");
  if (!withPhoto || !withPhoto.photoUrl) return null;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(withPhoto.photoUrl, SIGNED_URL_EXPIRE_SEC);
  if (error || !data?.signedUrl) return null;

  return {
    signedUrl: data.signedUrl,
    storagePath: withPhoto.photoUrl,
    resumeId: withPhoto.id,
    resumeTitle: withPhoto.title,
    resumeUpdatedAt: withPhoto.updatedAt,
  };
}
