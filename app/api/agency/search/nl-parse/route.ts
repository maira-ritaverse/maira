/**
 * POST /api/agency/search/nl-parse
 *
 * 自然文検索 (Tier 4 プロト) の解釈エンドポイント。
 * ユーザーの自由文を Claude Haiku 4.5 で JobFilters / ClientFilters に変換して返す。
 *
 * 認証: org member (requireOrgMember)。個人アカウントは 403。
 * キャッシュ: nl_search_cache (24h TTL) で同一クエリの重複呼び出しを抑える。
 *
 * 入力: { resource: "jobs" | "clients", query: string(1..500) }
 * 出力:
 *   200 { source: "cache"|"ai", filters: {...}, model: string }
 *   400 { error: "invalid_request", message: string }
 *   401 / 403 認証ガード
 *   502 { error: "parse_failed", message: string }
 */

import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { nlParseRequestSchema } from "@/lib/search/nl-parse-schema";
import { parseClientsQuery, parseJobsQuery } from "@/lib/search/nl-parse";

// Claude Haiku は 5-8 秒程度で返るが、Vercel デフォルト 10 秒だとキャッシュミス時に
// 微妙なので余裕を持って 30 秒。
export const maxDuration = 30;

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "JSON パースに失敗しました" },
      { status: 400 },
    );
  }

  const parsed = nlParseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: parsed.error.issues.map((i) => i.message).join(" / "),
      },
      { status: 400 },
    );
  }

  const { resource, query } = parsed.data;
  const result =
    resource === "jobs"
      ? await parseJobsQuery({ organizationId: organization.id, query })
      : await parseClientsQuery({ organizationId: organization.id, query });

  if (result.source === "error") {
    return NextResponse.json({ error: "parse_failed", message: result.message }, { status: 502 });
  }

  return NextResponse.json({
    source: result.source,
    filters: result.filters,
    model: result.model,
  });
}
