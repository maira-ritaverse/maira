/**
 * POST /api/agency/clients/[id]/intake-recording  (finalize)
 *
 * ブラウザが署名付き URL 経由で career-intake-audio バケットへ「直アップロード」した
 * 録音を、career_intake_recordings に登録する(status='uploaded' → 既存 cron が拾って
 * Whisper + Claude を回す)。
 *
 * ファイル本体はこのルートを通らない。Vercel の Serverless ボディ制限(約 4.5MB)を
 * 回避するため、「/sign で事前チェック + 署名発行 → ブラウザから Storage へ直送 →
 * 本ルートでメタ登録」の 2 段構成にしている(sign 側 route.ts 参照)。
 *
 * 入力: { recordingId, storagePath, filename, sizeBytes? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { checkIntakeLimit } from "@/lib/features/usage-limits";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "career-intake-audio";

const bodySchema = z.object({
  recordingId: z.string().uuid(),
  storagePath: z.string().min(1).max(300),
  filename: z.string().min(1).max(300),
  sizeBytes: z.number().int().nonnegative().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;
  const { id: clientRecordId } = await context.params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  // storagePath は必ず自分の user_id 始まり、かつ recordingId を含むこと。
  // 他人のオブジェクトや任意パスを指す行を作らせない(直アップロード方式の要の防御)。
  const expectedPrefix = `${user.id}/`;
  if (
    !parsed.data.storagePath.startsWith(expectedPrefix) ||
    !parsed.data.storagePath.includes(parsed.data.recordingId)
  ) {
    return NextResponse.json({ error: "invalid_storage_path" }, { status: 400 });
  }

  // 録音アップロードは admin の有効化が唯一の開放条件(運営オーバーライド)。
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("recording_upload_enabled")
    .eq("id", organization.id)
    .maybeSingle();
  if (!orgRow?.recording_upload_enabled) {
    return NextResponse.json(
      {
        error: "recording_upload_not_enabled",
        message: "録音アップロードによる AI ヒアリング機能は現在開発中です。近日提供予定。",
      },
      { status: 403 },
    );
  }

  // 対象クライアントが自組織のもの + 本人連携済みか
  const { data: clientRow, error: clientErr } = await supabase
    .from("client_records")
    .select("id, linked_user_id")
    .eq("id", clientRecordId)
    .maybeSingle();
  if (clientErr || !clientRow) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  if (!(clientRow as { linked_user_id: string | null }).linked_user_id) {
    return NextResponse.json(
      {
        error: "client_not_linked",
        message:
          "この求職者は Myaira アカウントを連携していないため、本人に確認依頼を送れません。先に招待してください。",
      },
      { status: 409 },
    );
  }

  // 月次上限(挿入直前に再チェック = 実際の cap はここ。無料 3 件 / アドオン 50 件)
  const limit = await checkIntakeLimit(supabase, user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "intake_limit_exceeded",
        message: `今月の AI ヒアリング上限(${limit.limit} 件)に達しました。`,
        usage: limit,
      },
      { status: 402 },
    );
  }

  // 実体が本当に Storage に存在するか確認(orphan 行 = cron が拾って失敗するのを防ぐ)。
  const service = createServiceClient();
  const objectName = parsed.data.storagePath.slice(expectedPrefix.length);
  const { data: listed, error: listErr } = await service.storage
    .from(BUCKET)
    .list(user.id, { search: parsed.data.recordingId, limit: 100 });
  if (listErr) {
    return NextResponse.json(
      { error: "storage_check_failed", message: listErr.message },
      { status: 500 },
    );
  }
  const obj = listed?.find((o) => o.name === objectName);
  if (!obj) {
    return NextResponse.json(
      {
        error: "upload_not_found",
        message: "アップロードが確認できませんでした。もう一度お試しください。",
      },
      { status: 400 },
    );
  }
  const sizeBytes = (obj.metadata as { size?: number } | null)?.size ?? parsed.data.sizeBytes ?? 0;

  // DB 行を作成(uploaded 状態 + エージェント面談モード + クライアント紐づけ)
  const { error: insErr } = await supabase.from("career_intake_recordings").insert({
    id: parsed.data.recordingId,
    user_id: user.id,
    storage_path: parsed.data.storagePath,
    original_filename: parsed.data.filename,
    size_bytes: sizeBytes,
    status: "uploaded",
    transcript_purpose: "agency_interview",
    client_record_id: clientRecordId,
  });
  if (insErr) {
    // 行作成に失敗したら、宙に浮くアップロード済みオブジェクトを掃除する。
    await service.storage.from(BUCKET).remove([parsed.data.storagePath]);
    return NextResponse.json(
      { error: "db_insert_failed", message: insErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      recordingId: parsed.data.recordingId,
      message: "アップロードを受け付けました。処理が完了すると求職者にレビュー依頼が届きます。",
    },
    { status: 201 },
  );
}
