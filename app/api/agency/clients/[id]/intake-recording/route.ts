/**
 * POST /api/agency/clients/[id]/intake-recording
 *
 * エージェントが「クライアント(求職者)を指定して」音声をアップロードする。
 *
 * 流れ:
 *   1) ファイル受領 (multipart/form-data の "file")
 *   2) RLS で対象 client_record を取得して linked_user_id を確認
 *      (linked = 求職者本人が登録済の Myaira アカウントを持っている状態)
 *   3) Storage に保存(career-intake-audio バケット)
 *      ※ 既存 Storage RLS は「先頭セグメント = 自分の user_id」なので、
 *         エージェント本人(user.id)ベースのパスにする
 *   4) career_intake_recordings に行を作成
 *      ・user_id        : エージェント本人(処理権限の都合)
 *      ・client_record_id: 対象クライアント
 *      ・transcript_purpose : 'agency_interview'
 *      ・status='uploaded' → 既存 cron pickup が拾って Whisper + Claude を回す
 *   5) 処理完了時(pickup 側で extracted になったとき)に
 *      meeting_interview_shares が自動作成されて求職者に通知される(別 PR で実装)
 *
 * 制限:
 *   - 25 MiB(Whisper 単一上限)
 *   - linked_user_id がない場合は 409(本人にレビュー依頼を送れないため不可)
 */
import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { checkIntakeLimit } from "@/lib/features/usage-limits";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;
  const { id: clientRecordId } = await context.params;

  // 録音 アップロード は 組織 単位 で 運営 が 手動 有効 化 する 機能。
  // デフォルト 無効。 organizations.recording_upload_enabled を 確認。
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

  // 対象クライアントが自組織のものか + linked_user_id 取得
  const { data: clientRow, error: clientErr } = await supabase
    .from("client_records")
    .select("id, name, linked_user_id")
    .eq("id", clientRecordId)
    .maybeSingle();
  if (clientErr || !clientRow) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  const client = clientRow as { id: string; name: string; linked_user_id: string | null };
  if (!client.linked_user_id) {
    return NextResponse.json(
      {
        error: "client_not_linked",
        message:
          "この求職者は Myaira アカウントを連携していないため、本人に確認依頼を送れません。先に招待してください。",
      },
      { status: 409 },
    );
  }

  // 月次利用上限チェック(エージェント本人の枠を消費する設計。
  // 「組織として何件まで」にしたい場合は将来 limit 集計の主体を組織に切替)
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

  // 【運営オーバーライド】録音アップロードは admin の recording_upload_enabled で
  // 組織単位に有効化する運営判断の機能(上の 403 ゲートで担保済み)。実上限は上の
  // checkIntakeLimit(無料 月3件 / meeting_recording_auto アドオンで50件)に一本化し、
  // プラン tier(agency_recording_processed の recordingLimit)による追加ゲートは課さない。
  // → admin が有効化した組織は、プランに関わらず AI ヒアリングを利用できる。
  // (原価は運営が承知の上。有効化は admin トグルでコスト警告付きで行う)

  // multipart/form-data 受領
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `ファイルが大きすぎます(最大 ${MAX_BYTES / 1024 / 1024} MiB)` },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `非対応のファイル形式です(MIME: ${file.type})` },
      { status: 415 },
    );
  }
  const filename = (form.get("filename") as string | null) ?? `client-${client.id}-${Date.now()}`;

  // Storage パス:エージェント user.id 起点(既存 Storage RLS と整合)
  const recordingId = crypto.randomUUID();
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "bin";
  const storagePath = `${user.id}/${recordingId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("career-intake-audio")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: "storage_upload_failed", message: upErr.message },
      { status: 500 },
    );
  }

  // DB 行を作成(uploaded 状態 + エージェント面談モード + クライアント紐づけ)
  const { error: insErr } = await supabase.from("career_intake_recordings").insert({
    id: recordingId,
    user_id: user.id,
    storage_path: storagePath,
    original_filename: filename,
    size_bytes: file.size,
    status: "uploaded",
    transcript_purpose: "agency_interview",
    client_record_id: clientRecordId,
  });
  if (insErr) {
    // 失敗時は Storage の掃除
    await supabase.storage.from("career-intake-audio").remove([storagePath]);
    return NextResponse.json(
      { error: "db_insert_failed", message: insErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      recordingId,
      message: "アップロードを受け付けました。処理が完了すると求職者にレビュー依頼が届きます。",
    },
    { status: 201 },
  );
}
