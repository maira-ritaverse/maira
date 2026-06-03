import { createClient } from "@/lib/supabase/server";

/**
 * 履歴書写真の Storage パスから署名付き URL を発行するヘルパー
 *
 * resume-photos バケットは private のため、画像表示には署名URLが必須。
 * 本人のセッション(@/lib/supabase/server の createClient = ssr cookie)で
 * 呼ぶこと。Storage RLS により他人のパスは弾かれる(発行できない)。
 *
 * 有効期限の使い分け:
 *   - プレビュー(画面表示):長め(60 分)。ユーザがページを開いたまま
 *     しばらく作業しても切れないようにする。
 *   - PDF 生成:短命(5 分)。Puppeteer が取得した直後に期限切れになる方が
 *     URL 漏えい時の被害を最小化できる。
 *
 * 失敗時は null を返す:
 *   - 呼び出し側(プレビュー/HTML)はプレースホルダ(「写真をはる位置」)を
 *     表示するフォールバックがあるため、画面全体を落とさない方が UX 上良い。
 */

const BUCKET = "resume-photos";

// プレビュー表示:1 時間。ページを開いたままにしても余裕がある。
export const PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC = 60 * 60;
// PDF 生成:5 分。Puppeteer は networkidle0 で待つので、取得した直後には
// 期限が切れる(漏れても再利用されにくい)。
export const PHOTO_SIGNED_URL_PDF_EXPIRES_SEC = 5 * 60;

export async function createResumePhotoSignedUrl(
  photoPath: string,
  expiresInSec: number,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(photoPath, expiresInSec);
  if (error || !data?.signedUrl) {
    // パスが存在しない/他人のパス/RLS で弾かれた等。
    // ここで throw すると画面全体が落ちるので null で握りつぶし、
    // 呼び出し側でプレースホルダにフォールバックさせる。
    return null;
  }
  return data.signedUrl;
}
