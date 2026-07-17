import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import {
  deleteSourceDocument,
  getSourceDocument,
} from "@/lib/agency-client-source-documents/queries";
import { STORAGE_BUCKET } from "@/lib/agency-client-source-documents/types";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * /api/agency/clients/[id]/source-documents/[docId]
 *
 *   GET    ダウンロード 用 の 短命 署名 URL を 返す (60 秒 有効)。
 *          レスポンス: { downloadUrl, fileName, mimeType }
 *   DELETE ファイル + DB 行 を 削除
 *
 * 認可:
 *   ・requireOrgMember
 *   ・doc の organization_id が 呼び出し ユーザー の 組織 と 一致
 *   ・path の 先頭 セグメント が 組織 ID (Storage RLS でも 二重 チェック)
 *
 * 署名 URL の 有効 時間 は 60 秒 に した:
 *   ・「開いた ら すぐ ダウンロード」 が UX なので 短命 で 良い
 *   ・URL を コピー されて 外部 に 貼られる 事故 の 窓 を 狭める
 *   ・Zoom 診断 ページ の photo は 5 分 (画像 表示 の ため) だが、 元書類 は
 *     ダウンロード 想定 で 開いて 即 保存 する 流れ なので 60 秒 で 十分
 */
export const runtime = "nodejs";

const DOWNLOAD_URL_EXPIRES_SEC = 60;

type RouteParams = { params: Promise<{ id: string; docId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { id: clientRecordId, docId } = await params;
  const doc = await getSourceDocument(supabase, {
    organizationId: organization.id,
    id: docId,
  });
  if (!doc || doc.clientRecordId !== clientRecordId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 署名 URL 生成 は service_role で。 有効 時間 は 短命。
  // download オプション を 渡す と Response の Content-Disposition が attachment
  // 付き で 返り、 元 の file_name で 保存 させる こと が できる。
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(doc.storagePath, DOWNLOAD_URL_EXPIRES_SEC, {
      download: doc.fileName,
    });

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "signed_url_failed", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    downloadUrl: data.signedUrl,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { id: clientRecordId, docId } = await params;
  const doc = await getSourceDocument(supabase, {
    organizationId: organization.id,
    id: docId,
  });
  if (!doc || doc.clientRecordId !== clientRecordId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Storage → DB の 順 で 削除。 Storage 削除 失敗 でも DB は 消して、 メタ 上
  // 見えなく する (ゴミ ファイル は バケット の 保守 で 掃除。 万一 の 場合 でも
  // path が 決まれば 手動 削除 可能)。
  const service = createServiceClient();
  await service.storage
    .from(STORAGE_BUCKET)
    .remove([doc.storagePath])
    .catch(() => {
      // Storage 側 の 削除 失敗 は 無視 (次 の DB 削除 で メタ 上 は 消える)
    });

  try {
    await deleteSourceDocument(supabase, {
      organizationId: organization.id,
      id: docId,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "delete_failed",
        message: err instanceof Error ? err.message : "Unknown",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
