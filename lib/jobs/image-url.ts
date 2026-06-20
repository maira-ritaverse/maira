/**
 * 求人 画像 (job-images バケット) の 公開 URL 取得 ヘルパー
 *
 * LINE 配信 用 の 優先 順位:
 *   line_share_image_path → hero_image_path → null
 *
 * 公開 バケット なので 認証 不要 で 取れる。 LINE Flex の hero に そのまま 渡せる。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "job-images";

export function getJobImagePublicUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl ?? null;
}

/**
 * LINE 配信 で 使う 画像 URL を 計算。
 * line_share_image_path 優先、 なければ hero_image_path、 どちら も なければ null。
 */
export function getJobShareImageUrl(
  supabase: SupabaseClient,
  job: { hero_image_path?: string | null; line_share_image_path?: string | null },
): string | null {
  return (
    getJobImagePublicUrl(supabase, job.line_share_image_path) ??
    getJobImagePublicUrl(supabase, job.hero_image_path)
  );
}
