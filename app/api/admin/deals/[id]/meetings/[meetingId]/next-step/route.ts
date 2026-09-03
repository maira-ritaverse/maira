import { generateText } from "ai";
import { NextResponse } from "next/server";

import { getModel, MODELS } from "@/lib/ai/client";
import { buildSalesNextStepPrompt } from "@/lib/ai/prompts/sales-next-step";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { getMeeting, getProspect, listMeetings, saveMeetingAdvice } from "@/lib/sales/queries";
import { SALES_STAGES } from "@/lib/sales/types";

/**
 * POST /api/admin/deals/[id]/meetings/[meetingId]/next-step
 *
 * 議事録の履歴 + 現在のステージ + プレイブックから AI が次アクションを提案し、
 * このミーティングに保存する。is_maira_admin 限定。
 */
export const runtime = "nodejs";
export const maxDuration = 120;

type RouteParams = { params: Promise<{ id: string; meetingId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: prospectId, meetingId } = await params;

  const [prospect, targetMeeting, meetings] = await Promise.all([
    getProspect(prospectId),
    getMeeting(meetingId),
    listMeetings(prospectId),
  ]);
  // meetingId が URL の商談に属することを確認(取り違え防止)
  if (!prospect || !targetMeeting || targetMeeting.prospectId !== prospectId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const stageDef = SALES_STAGES.find((s) => s.key === prospect.stage);
  const { system, prompt } = buildSalesNextStepPrompt({
    companyName: prospect.companyName,
    stageLabel: stageDef?.label ?? prospect.stage,
    stageDescription: stageDef?.description ?? "",
    meetings: meetings.map((m) => ({
      meetingNo: m.meetingNo,
      stageLabel: m.stage ? (SALES_STAGES.find((s) => s.key === m.stage)?.label ?? null) : null,
      date: m.meetingDate ?? m.createdAt.slice(0, 10),
      minutes: m.minutes,
    })),
  });

  let advice: string;
  try {
    const res = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
      maxOutputTokens: 2500,
    });
    advice = res.text.trim();
    if (advice.length === 0) {
      return NextResponse.json(
        { error: "empty", message: "AI の応答が空でした。もう一度お試しください。" },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "ai_failed",
        message: err instanceof Error ? err.message : "AI 呼び出しに失敗しました",
      },
      { status: 502 },
    );
  }

  const saved = await saveMeetingAdvice(meetingId, advice, MODELS.CONVERSATION);
  if ("error" in saved) {
    return NextResponse.json({ error: "save_failed", message: saved.error }, { status: 500 });
  }

  return NextResponse.json({ advice });
}
