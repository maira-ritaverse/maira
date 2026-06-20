/**
 * MA 配信 メッセージ 内 URL の トラッキング 短縮 化 (Deno / Edge Function 版)。
 *
 * Web 側 lib/ma/click-tracking.ts と 同じ ロジック を Deno 用 に 移植。
 * 1 配信 で 同じ URL は 1 link で 共有。
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_RE = /https?:\/\/[\w\-._~:/?#@!$&'()*+,;=%]+/g;

export type WrapUrlsArgs = {
  organizationId: string;
  /** 任意。 紐付け なし でも 集計 可能 */
  sendLogId?: string | null;
  body: string;
  /** デフォルト site URL (例 https://www.maira.pro)。 末尾 スラッシュ 無し */
  siteUrl: string;
};

export async function wrapBodyUrls(admin: SupabaseClient, args: WrapUrlsArgs): Promise<string> {
  const matches = Array.from(args.body.matchAll(URL_RE));
  if (matches.length === 0) return args.body;

  const uniqueUrls = Array.from(new Set(matches.map((m) => m[0])));
  const rows = uniqueUrls.map((url) => ({
    organization_id: args.organizationId,
    send_log_id: args.sendLogId ?? null,
    original_url: url,
  }));

  const { data, error } = await admin
    .from("ma_click_links")
    .insert(rows)
    .select("id, original_url");
  if (error || !data) {
    console.warn("[click-tracking] insert failed", error?.message);
    return args.body;
  }
  type Row = { id: string; original_url: string };
  const map = new Map<string, string>(((data as Row[]) ?? []).map((r) => [r.original_url, r.id]));

  let result = args.body;
  for (const url of uniqueUrls) {
    const token = map.get(url);
    if (!token) continue;
    const shortUrl = `${args.siteUrl}/r/${token}`;
    result = result.split(url).join(shortUrl);
  }
  return result;
}
