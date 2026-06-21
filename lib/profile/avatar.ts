/**
 * ユーザー アバター 画像 の Storage パス / public URL を 扱う ヘルパー
 *
 * バケット avatar-images は public で 作成 さ れて いる ため、 公開 URL を
 * そのまま <img> に 渡せ ば 表示 可能。 ただし 同 ファイル を 上書き した 直後
 * は ブラウザ キャッシュ で 古い 画像 が 出る 場合 が ある ため、 URL 末尾 に
 * バージョン パラメータ (= path 自体 が 一意 の epoch ms を 含む) を 付ける
 * 設計 で 対応 する (= 画像 を 上げ直す と path も 変わる)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "avatar-images";

/**
 * Storage パス から public URL を 解決 する。
 * Storage クライアント が 必要 な だけ で 認証 は 不要。
 */
export function resolveAvatarPublicUrl(
  client: SupabaseClient,
  storagePath: string | null,
): string | null {
  if (!storagePath) return null;
  const { data } = client.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * 新規 アップロード 用 の Storage パス を 生成 する 純関数。
 * フォーマット: {userId}/avatar-{epochms}.{ext}
 * - フォルダ 1 階層 目 が user_id = RLS で auth.uid() と 突合 さ れる
 * - ファイル名 に epoch ms を 含む = 上書き 後 の キャッシュ 問題 回避
 */
export function buildAvatarStoragePath(userId: string, mime: string, nowMs: number): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${userId}/avatar-${nowMs}.${ext}`;
}
