import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getSourceDocument } from "@/lib/agency-client-source-documents/queries";
import { STORAGE_BUCKET } from "@/lib/agency-client-source-documents/types";
import {
  CLIENT_EXTRACT_MAX_BYTES,
  extractClientFromDocument,
  isSupportedClientExtractMime,
} from "@/lib/clients/ai-extract-from-document";
import {
  CLIENT_EXTRACTION_FIELD_KEYS,
  CLIENT_EXTRACTION_KEY_TO_CAMEL,
} from "@/lib/ai/prompts/client-extract-from-document";
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
        message: `組織の月次 AI 利用上限に達しました (${usage.current} / ${usage.limit})。来月のリセット後、または管理者が設定変更後に再試行してください。`,
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
        message: `AI抽出に対応していない形式です (${doc.mimeType})。`,
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
        message: `AI抽出対象のファイルサイズは${CLIENT_EXTRACT_MAX_BYTES / 1024 / 1024}MB以下にしてください。大きいPDFはページを分割して保存し直すか、手入力してください。`,
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
        message: dl.error?.message ?? "元書類の読込に失敗しました",
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
            ? "AI出力の構造が不正でした。再度お試しください。"
            : "AI呼び出しに失敗しました。時間を置いて再度お試しください。",
        detail: ai.message,
      },
      { status },
    );
  }

  // ── 現状 の client_record を 取得 (プレビュー UI の 差分 表示 用)。
  //    復号 込み だ が、 復号 に 失敗 して も extraction は 返せる ので try/catch。
  //    キー は CLIENT_EXTRACTION_FIELD_KEYS × CLIENT_EXTRACTION_KEY_TO_CAMEL の
  //    対応 で 機械 的 に 埋め る (手書き マッピング だと フィールド 追加 時 に
  //    ここ の 更新 漏れ で 「差分 プレビュー が 常に 空 → 誤 上書き」 に なる)。
  const current: Record<string, unknown> = {};
  try {
    const client = await getClientRecordWithDecrypted(clientRecordId);
    if (client) {
      const record = client as unknown as Record<string, unknown>;
      for (const key of CLIENT_EXTRACTION_FIELD_KEYS) {
        const camel = CLIENT_EXTRACTION_KEY_TO_CAMEL[key];
        const raw = record[camel];
        // 数値 (年収) は null を そのまま (0 と 未入力 の 区別 を UI で 判定)、
        // 文字列 は null → ""、 配列 は null → [] に 正規化 して 抽出値 と キー を
        // 揃える (プレビュー 側 の hasDiff / displayValue が シンプル に なる)。
        if (key === "current_annual_income" || key === "desired_annual_income") {
          current[key] = raw ?? null;
        } else if (
          key === "experience_industries" ||
          key === "experience_occupations" ||
          key === "desired_industries" ||
          key === "desired_occupations" ||
          key === "desired_locations"
        ) {
          current[key] = Array.isArray(raw) ? raw : [];
        } else {
          current[key] = typeof raw === "string" ? raw : "";
        }
      }
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
  //    が CLIENT_EXTRACTION_FIELD_KEYS を そのまま import して loop できる。
  const { extraction_notes, confidence, ...extractedFields } = ai.result;
  return NextResponse.json({
    extracted: extractedFields,
    current,
    extractionNotes: extraction_notes,
    confidence,
  });
}
