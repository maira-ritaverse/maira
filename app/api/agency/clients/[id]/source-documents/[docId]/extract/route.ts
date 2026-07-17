import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getSourceDocument } from "@/lib/agency-client-source-documents/queries";
import { STORAGE_BUCKET } from "@/lib/agency-client-source-documents/types";
import {
  CLIENT_EXTRACT_MAX_BYTES,
  extractClientFromDocument,
  isSupportedClientExtractMime,
} from "@/lib/clients/ai-extract-from-document";
import { CLIENT_EXTRACTION_FIELD_KEYS } from "@/lib/ai/prompts/client-extract-from-document";
import { getClientRecordWithDecrypted } from "@/lib/clients/queries";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/clients/[id]/source-documents/[docId]/extract
 *
 * 元書類 (Phase 1 で アップロード 済 の PDF / 画像) を Claude Sonnet 4.6 に
 * 通して、 client_records の プロフィール項目 を 構造化 抽出 する。
 *
 * DB へ の 反映 は 行わ ない: 呼び出し 元 (プレビュー モーダル) が
 * 「どの 項目 を 上書き するか」 を ユーザー に 選ばせて、 選ばれた もの だけ を
 * 通常 の PATCH /api/agency/clients/[id] に 流し込む 2 段階 フロー。
 * AI が ミスして も DB を 汚さない 設計 (job parse-document と 同型)。
 *
 * レスポンス:
 *   {
 *     extracted: { <field_key>: <value>, ..., extraction_notes, confidence },
 *     current:   { <field_key>: <value>, ... },   // client_records の 現状
 *   }
 *   ・extracted / current は キー が 揃って いる ので UI 側 で 単純 な diff が 描ける
 *   ・数値 / 配列 / enum は 実 型 で 返る (UI で string 化 する)
 *
 * セキュリティ:
 *   ・requireOrgMember: 求職者 / 未認証 は 403
 *   ・source_document.organization_id が 呼出 ユーザー の org と 一致 する こと
 *     (RLS でも 弾かれる が、 二重 チェック)
 *   ・source_document.client_record_id が path の :id と 一致 する こと
 *   ・元 バイナリ は Anthropic API に 送る (プライバシー ポリシー 第 5 条 の
 *     AI 処理 範囲)。 サーバー / DB / Storage に は 抽出 結果 を 一切 残さ ない。
 */
export const runtime = "nodejs";
// PDF は 数 ページ の Vision 集約 で 60-120 秒 かかる こと が ある。 job 抽出
// (parse-document) と 同じ く 300 秒 に 拡張。
export const maxDuration = 300;

type RouteParams = { params: Promise<{ id: string; docId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, user } = guard;

  const { id: clientRecordId, docId } = await params;

  // ── 元書類 メタ 取得 + 権限 確認
  const doc = await getSourceDocument(supabase, {
    organizationId: organization.id,
    id: docId,
  });
  if (!doc || doc.clientRecordId !== clientRecordId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ── クォータ チェック (組織 横断 月次)
  const usage = await checkAiUsageLimit(supabase, user.id, "agency_client_document_extract");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました (${usage.current} / ${usage.limit})。 来月のリセット後、 または 管理者が 設定変更後に 再試行してください。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  // ── MIME check (Storage には JPEG/PNG/PDF が 入り 得る。 Anthropic は webp も 通る
  //    が、 upload 側 で 弾いて いる ので 実質 3 種類)
  if (!isSupportedClientExtractMime(doc.mimeType)) {
    return NextResponse.json(
      {
        error: "unsupported_mime",
        message: `AI 抽出 に 対応 して いない 形式 です (${doc.mimeType})。`,
      },
      { status: 400 },
    );
  }

  // ── サイズ check (Storage 上限 は 20MB だ が、 Anthropic PDF は 10MB 相当 で
  //    503 を 返す ため、 事前 に 弾いて 分かり やすい エラー に する)
  if (doc.fileSize > CLIENT_EXTRACT_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `AI 抽出 対象 の ファイル サイズ は ${CLIENT_EXTRACT_MAX_BYTES / 1024 / 1024}MB 以下 に して ください。 大きい PDF は ページ を 分割 して 保存 し 直す か、 手入力 して ください。`,
      },
      { status: 400 },
    );
  }

  // ── Storage から バイナリ を 取得 (service_role で 直接 download)
  const service = createServiceClient();
  const dl = await service.storage.from(STORAGE_BUCKET).download(doc.storagePath);
  if (dl.error || !dl.data) {
    return NextResponse.json(
      {
        error: "storage_read_failed",
        message: dl.error?.message ?? "元書類 の 読込 に 失敗しました",
      },
      { status: 500 },
    );
  }
  const data = new Uint8Array(await dl.data.arrayBuffer());

  // ── AI 抽出
  const ai = await extractClientFromDocument({
    data,
    mimeType: doc.mimeType,
  });
  if (!ai.ok) {
    const status = 502;
    return NextResponse.json(
      {
        error: ai.reason,
        message:
          ai.reason === "schema_error"
            ? "AI 出力 の 構造 が 不正 でした。 再度 お試し ください。"
            : "AI 呼び出し に 失敗 しました。 時間 を 置いて 再度 お試し ください。",
        detail: ai.message,
      },
      { status },
    );
  }

  // ── 現状 の client_record を 取得 (プレビュー UI の 差分 表示 用)。
  //    復号 込み だ が、 復号 に 失敗 して も extraction は 返せる ので try/catch。
  let current: Record<string, unknown> = {};
  try {
    const client = await getClientRecordWithDecrypted(clientRecordId);
    if (client) {
      current = {
        name: client.name ?? "",
        name_kana: client.nameKana ?? "",
        birth_date: client.birthDate ?? "",
        gender: client.gender ?? "",
        nationality: client.nationality ?? "",
        marital_status: client.maritalStatus ?? "",
        phone: client.phone ?? "",
        phone2: client.phone2 ?? "",
        email: client.email ?? "",
        email2: client.email2 ?? "",
        postal_code: client.postalCode ?? "",
        prefecture: client.prefecture ?? "",
        city: client.city ?? "",
        street: client.street ?? "",
        building: client.building ?? "",
        current_employment_type: client.currentEmploymentType ?? "",
        current_annual_income: client.currentAnnualIncome,
        final_education: client.finalEducation ?? "",
        experience_industries: client.experienceIndustries ?? [],
        experience_occupations: client.experienceOccupations ?? [],
        desired_industries: client.desiredIndustries ?? [],
        desired_occupations: client.desiredOccupations ?? [],
        desired_locations: client.desiredLocations ?? [],
        desired_annual_income: client.desiredAnnualIncome,
        job_change_timing: client.jobChangeTiming ?? "",
        education_detail: client.educationDetail ?? "",
        skills: client.skills ?? "",
        job_change_reason: client.jobChangeReason ?? "",
        desired_conditions: client.desiredConditions ?? "",
      };
    }
  } catch (err) {
    console.warn("[client-extract] current fetch failed", err);
    // current が 空 の まま でも 抽出結果 だけ 返す (プレビュー は 現状 なし で 表示)
  }

  // ── 利用ログ (失敗 して も 本処理 は 止め ない)
  await recordAiUsage(supabase, user.id, "agency_client_document_extract", {
    source_document_id: docId,
    client_record_id: clientRecordId,
    mime_type: doc.mimeType,
    bytes: doc.fileSize,
    confidence: ai.result.confidence,
  });

  // ── レスポンス。 抽出結果 は client_records キー に 揃って いる の で、 呼出 側
  //    が field key で 直接 loop できる。
  const { extraction_notes, confidence, ...extractedFields } = ai.result;
  return NextResponse.json({
    extracted: extractedFields,
    current,
    extractionNotes: extraction_notes,
    confidence,
    // 呼出 側 が 参照 する 用 (単一 source of truth)。 UI 側 で は import しても OK。
    fieldKeys: CLIENT_EXTRACTION_FIELD_KEYS,
  });
}
