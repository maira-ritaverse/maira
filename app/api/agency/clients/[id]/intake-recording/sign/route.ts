import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { checkIntakeLimit } from "@/lib/features/usage-limits";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/clients/[id]/intake-recording/sign
 *
 * ブラウザ → Supabase Storage への「直アップロード」用の署名付き URL を発行する。
 *
 * なぜ必要か:
 *   Vercel の Serverless Function はリクエストボディが約 4.5MB に制限されるため、
 *   会議音声(数十 MB)をアプリのルート経由で送ると、アプリの 25MB チェックに届く前に
 *   Vercel が 413 で弾く。ファイル本体はブラウザから Storage へ直接送り、アプリは
 *   事前チェックと署名発行・行作成(finalize)だけを担う。
 *
 * この sign は「アップロードして良いか」を検査し、OK なら storagePath と upload token を
 * 返す。実ファイルはクライアントが uploadToSignedUrl で送り、成功後に親ルート(POST)へ
 * finalize してもらう(行作成)。
 *
 * 入力: { filename, size, contentType }
 * 出力: { recordingId, storagePath, token }
 */

const BUCKET = "career-intake-audio";
const MAX_BYTES = 25 * 1024 * 1024; // Whisper 単一上限 = バケット file_size_limit と一致
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

const bodySchema = z.object({
  filename: z.string().min(1).max(300),
  size: z.number().int().positive(),
  // 空文字を許容(ブラウザが MIME を付けないファイルがあるため。空なら Storage 側の
  // allowed_mime_types で最終判定する)。
  contentType: z.string().max(100).default(""),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;
  const { id: clientRecordId } = await context.params;

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

  // 対象クライアントが自組織のもの + 本人連携済みか(本人へレビュー依頼を送る前提)
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

  // 月次上限(無料 3 件 / meeting_recording_auto アドオンで 50 件)
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

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  if (parsed.data.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `ファイルが大きすぎます(最大 ${MAX_BYTES / 1024 / 1024} MiB)`,
      },
      { status: 413 },
    );
  }
  if (parsed.data.contentType && !ALLOWED_MIME.has(parsed.data.contentType)) {
    return NextResponse.json(
      {
        error: "unsupported_mime",
        message: `非対応のファイル形式です(${parsed.data.contentType})`,
      },
      { status: 415 },
    );
  }

  // パスは user_id 始まり固定(Storage RLS "先頭セグメント = user_id" と一致)。
  // recordingId は career_intake_recordings.id 兼ファイル名にして finalize で突合する。
  const recordingId = crypto.randomUUID();
  const rawExt = parsed.data.filename.includes(".")
    ? parsed.data.filename.split(".").pop()!.toLowerCase()
    : "";
  const ext = rawExt.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const storagePath = `${user.id}/${recordingId}.${ext}`;

  // 署名付きアップロード URL は service client で発行(パスは server 側で固定済みなので安全)。
  const service = createServiceClient();
  const { data: signed, error: signErr } = await service.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: "sign_failed", message: signErr?.message ?? "アップロードURLの発行に失敗しました" },
      { status: 500 },
    );
  }

  return NextResponse.json({ recordingId, storagePath, token: signed.token });
}
