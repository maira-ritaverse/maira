/**
 * MA 配信 メッセージ 内 の URL を 短縮 トラッキング URL に 置換 する ヘルパー。
 *
 * 仕組み:
 *   1. 本文 内 の http(s) URL を 正規表現 で 抽出
 *   2. それぞれ を ma_click_links に INSERT し、 生成 された id を 取得
 *   3. 元 URL を `${SITE_URL}/r/{id}` に 置換 した 本文 を 返す
 *
 * 同じ URL が 1 本文 内 に 複数回 出て も 1 link で 共用 する。
 * (1 配信 で 1 ユーザー の マウス は 同じ URL を 数回 押すよりも 別 URL を 押す
 *  方が 普通 な ので、 ma_click_links 行 数 を 抑える 効果 が ある)
 *
 * service_role を 想定 (cron / 内部 API から 呼ぶ)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAbsoluteUrl } from "@/lib/config/site-url";

// URL 抽出 用 正規表現。 LINE / Email 共通 で 使う。
// 末尾 の 句点 / 全角 / 半角 記号 は URL に 含めない。
const URL_RE = /https?:\/\/[\w\-._~:/?#@!$&'()*+,;=%]+/g;

export type WrapUrlsArgs = {
  organizationId: string;
  /** 紐付け 任意。 送信 前 に ラップ する 場合 は null で 良い (集計 は 組織 単位)。 */
  sendLogId?: string | null;
  body: string;
};

/**
 * 本文 内 の URL を トラッキング URL に 置換 して 返す。
 * URL が 1 つ も 無ければ body を そのまま 返す。
 */
export async function wrapBodyUrls(admin: SupabaseClient, args: WrapUrlsArgs): Promise<string> {
  const matches = Array.from(args.body.matchAll(URL_RE));
  if (matches.length === 0) return args.body;

  // 一意 URL の 集合 (同じ URL を 何度も link に しない)
  const uniqueUrls = Array.from(new Set(matches.map((m) => m[0])));

  // ma_click_links に 一括 INSERT
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
    console.warn("[click-tracking] ma_click_links insert failed", error?.message);
    return args.body;
  }

  type Row = { id: string; original_url: string };
  const urlToToken = new Map(((data ?? []) as Row[]).map((r) => [r.original_url, r.id]));

  // 単純 文字列 置換 (正規表現 文字 を 含む URL も そのまま 当たる)
  let result = args.body;
  for (const url of uniqueUrls) {
    const token = urlToToken.get(url);
    if (!token) continue;
    const shortUrl = buildAbsoluteUrl(`/r/${token}`);
    // 同じ URL が 複数 出る ケース で 全部 置換
    result = result.split(url).join(shortUrl);
  }
  return result;
}
