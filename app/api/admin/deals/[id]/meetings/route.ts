import { generateText } from "ai";
import { NextResponse } from "next/server";

import { getModel, MODELS } from "@/lib/ai/client";
import { buildSalesMinutesPrompt } from "@/lib/ai/prompts/sales-minutes";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { transcribeWithWhisper } from "@/lib/career-intake/transcribe";
import {
  getMeeting,
  getProspect,
  insertMeeting,
  listMeetings,
  nextMeetingNo,
  saveMeetingResult,
} from "@/lib/sales/queries";
import { createServiceClient } from "@/lib/supabase/service";
import { SALES_STAGE_KEYS, type SalesStage } from "@/lib/sales/types";

/**
 * /api/admin/deals/[id]/meetings
 *   GET  - この商談のミーティング一覧
 *   POST - ミーティングを追加。録音アップロード(multipart)→ 文字起こし → 議事録、
 *          またはテキスト貼り付け(JSON)→ 議事録。is_maira_admin 限定。
 *
 * maxDuration: 録音の文字起こし(OpenAI)+ 議事録生成(Claude)で時間がかかるため 300 秒。
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const MAX_TITLE_CHARS = 200;
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

/**
 * 拡張子 → MIME(bucket の allowed_mime_types に含まれる値)。
 * Safari の MOV 等で file.type が空のとき、拡張子から contentType を決めるために使う
 * (bucket に application/octet-stream が無く、空だとアップロードが弾かれるため)。
 */
const EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mov: "video/quicktime",
};

type RouteParams = { params: Promise<{ id: string }> };

function normStage(v: unknown): SalesStage | null {
  return typeof v === "string" && (SALES_STAGE_KEYS as readonly string[]).includes(v)
    ? (v as SalesStage)
    : null;
}

/** 文字起こし / 貼り付けテキストから議事録を生成する(会社ごとの観点を反映)。 */
async function generateMinutes(
  sourceText: string,
  companyContext?: string | null,
): Promise<string> {
  const { system, prompt } = buildSalesMinutesPrompt(sourceText.slice(0, 60000), companyContext);
  const res = await generateText({
    model: getModel(MODELS.CONVERSATION),
    system,
    prompt,
    maxOutputTokens: 4000,
  });
  return res.text.trim();
}

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const meetings = await listMeetings(id);
  return NextResponse.json({ meetings });
}

export async function POST(request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: prospectId } = await params;
  const prospect = await getProspect(prospectId);
  if (!prospect) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const meetingNo = await nextMeetingNo(prospectId);

  // ── テキスト貼り付け(JSON) ──────────────────────────────────────
  if (contentType.includes("application/json")) {
    let body: {
      text?: string;
      title?: string | null;
      meeting_date?: string | null;
      stage?: string | null;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const text = (body.text ?? "").trim();
    if (text.length === 0) {
      return NextResponse.json({ error: "text_required" }, { status: 400 });
    }
    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: "too_long", message: `テキストが長すぎます(最大 ${MAX_TEXT_CHARS} 文字)` },
        { status: 413 },
      );
    }

    const ins = await insertMeeting({
      prospectId,
      meetingNo,
      source: "text",
      title: body.title ? body.title.slice(0, MAX_TITLE_CHARS) : null,
      meetingDate: body.meeting_date ?? null,
      stage: normStage(body.stage),
      status: "processing",
    });
    if ("error" in ins) {
      return NextResponse.json({ error: "create_failed", message: ins.error }, { status: 500 });
    }
    try {
      const minutes = await generateMinutes(text, prospect.aiPlaybook);
      await saveMeetingResult(ins.id, {
        transcript: text,
        minutes,
        model: MODELS.CONVERSATION,
        status: "ready",
      });
    } catch (err) {
      await saveMeetingResult(ins.id, {
        transcript: text,
        status: "failed",
        statusMessage: err instanceof Error ? err.message : "議事録の生成に失敗しました",
      });
    }
    const meeting = await getMeeting(ins.id);
    return NextResponse.json({ meeting }, { status: 201 });
  }

  // ── 録音アップロード(multipart) ────────────────────────────────
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: "too_large",
        message: `ファイルが大きすぎます(最大 ${MAX_BYTES / 1024 / 1024} MiB)`,
      },
      { status: 413 },
    );
  }
  const filename = (form.get("filename") as string | null) ?? `meeting-${Date.now()}`;
  const rawTitle = (form.get("title") as string | null) ?? null;
  const title = rawTitle ? rawTitle.slice(0, MAX_TITLE_CHARS) : null;
  const meetingDate = (form.get("meeting_date") as string | null) ?? null;
  const stage = normStage(form.get("stage"));

  // 拡張子は英数字のみに正規化(パスに / 等が混ざらないように)
  const rawExt = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const ext = /^[a-z0-9]+$/.test(rawExt) ? rawExt : "bin";
  // contentType:file.type が空(Safari の MOV 等)のときは拡張子から決める。bucket の
  // allowed_mime_types に無い値(application/octet-stream 等)は弾かれるため。
  const uploadContentType = file.type || EXT_TO_MIME[ext] || "";
  if (!uploadContentType || !ALLOWED_MIME.has(uploadContentType)) {
    return NextResponse.json(
      { error: "unsupported", message: `非対応の形式です(${file.type || ext})` },
      { status: 415 },
    );
  }

  const meetingId = crypto.randomUUID();
  const storagePath = `${prospectId}/${meetingId}.${ext}`;

  // Storage へアップロード(service_role。バケットは is_maira_admin 限定)
  const service = createServiceClient();
  const { error: upErr } = await service.storage
    .from("sales-meeting-audio")
    .upload(storagePath, file, { contentType: uploadContentType, upsert: false });
  if (upErr) {
    return NextResponse.json({ error: "upload_failed", message: upErr.message }, { status: 500 });
  }

  const ins = await insertMeeting({
    id: meetingId,
    prospectId,
    meetingNo,
    source: "upload",
    storagePath,
    originalFilename: filename,
    sizeBytes: file.size,
    title,
    meetingDate,
    stage,
    status: "processing",
  });
  if ("error" in ins) {
    // 行の作成に失敗したら、アップロード済みの音声を削除(孤立ファイル防止)
    await service.storage.from("sales-meeting-audio").remove([storagePath]);
    return NextResponse.json({ error: "create_failed", message: ins.error }, { status: 500 });
  }

  // 文字起こし → 議事録(失敗時は failed で保存し、行は残す)
  try {
    const tr = await transcribeWithWhisper({
      audio: file,
      filename,
      language: "ja",
      prompt: "これは営業ミーティングの録音です。",
    });
    if (!tr.ok) {
      await saveMeetingResult(meetingId, {
        status: "failed",
        statusMessage:
          tr.reason === "not_configured"
            ? "文字起こしAPIが未設定です(OPENAI_API_KEY)"
            : `文字起こしに失敗しました${tr.error ? `: ${tr.error}` : ""}`,
      });
    } else if (tr.text.trim().length === 0) {
      await saveMeetingResult(meetingId, {
        status: "failed",
        statusMessage: "音声から文字を検出できませんでした(無音の可能性)",
      });
    } else {
      const minutes = await generateMinutes(tr.text, prospect.aiPlaybook);
      await saveMeetingResult(meetingId, {
        transcript: tr.text,
        minutes,
        model: MODELS.CONVERSATION,
        status: "ready",
      });
    }
  } catch (err) {
    await saveMeetingResult(meetingId, {
      status: "failed",
      statusMessage: err instanceof Error ? err.message : "処理に失敗しました",
    });
  }

  const meeting = await getMeeting(meetingId);
  return NextResponse.json({ meeting }, { status: 201 });
}
