import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";

/**
 * GET /api/agency/line/activity/[lineUserId]
 *
 * 利用履歴 タイムライン:
 *   ・関連 求人 (line_messages.related_job_id を 集計、 重複 排除)
 *   ・関連 面談 (line_messages.related_meeting_schedule_id)
 *   ・LIFF 応募 (system message で 「LIFF から 応募」を 含む)
 *
 * 友達 ごと に 紐づく 行動 履歴 を 統合 して 時系列 で 返す。
 */
type RouteContext = { params: Promise<{ lineUserId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  // line_messages で 関連 ID 付き の もの を 抽出
  const { data: msgsData } = await guard.supabase
    .from("line_messages")
    .select("id, direction, message_type, related_job_id, related_meeting_schedule_id, created_at")
    .eq("line_user_id", lineUserId)
    .or("related_job_id.not.is.null,related_meeting_schedule_id.not.is.null")
    .order("created_at", { ascending: false })
    .limit(50);

  type MsgRow = {
    id: string;
    direction: "inbound" | "outbound";
    message_type: string;
    related_job_id: string | null;
    related_meeting_schedule_id: string | null;
    created_at: string;
  };
  const msgs = (msgsData ?? []) as MsgRow[];

  // 関連 求人 / 面談 を 一括 解決
  const jobIds = Array.from(new Set(msgs.map((m) => m.related_job_id).filter(Boolean) as string[]));
  const meetingIds = Array.from(
    new Set(msgs.map((m) => m.related_meeting_schedule_id).filter(Boolean) as string[]),
  );

  const jobMap = new Map<string, { id: string; companyName: string; position: string }>();
  if (jobIds.length > 0) {
    const { data: jobs } = await guard.supabase
      .from("job_postings")
      .select("id, company_name, position")
      .in("id", jobIds);
    for (const j of (jobs ?? []) as Array<{
      id: string;
      company_name: string;
      position: string;
    }>) {
      jobMap.set(j.id, { id: j.id, companyName: j.company_name, position: j.position });
    }
  }

  const meetingMap = new Map<
    string,
    { id: string; title: string; startsAt: string; status: string }
  >();
  if (meetingIds.length > 0) {
    const { data: meetings } = await guard.supabase
      .from("meeting_schedules")
      .select("id, title, starts_at, status")
      .in("id", meetingIds);
    for (const m of (meetings ?? []) as Array<{
      id: string;
      title: string;
      starts_at: string;
      status: string;
    }>) {
      meetingMap.set(m.id, { id: m.id, title: m.title, startsAt: m.starts_at, status: m.status });
    }
  }

  // タイムライン 構築
  type ActivityItem =
    | {
        kind: "job_share";
        at: string;
        jobId: string;
        companyName: string;
        position: string;
      }
    | {
        kind: "job_interest";
        at: string;
        jobId: string;
        companyName: string;
        position: string;
      }
    | {
        kind: "meeting_proposed" | "meeting_confirmed" | "meeting_canceled";
        at: string;
        meetingId: string;
        title: string;
        startsAt: string;
      };

  const items: ActivityItem[] = [];
  for (const m of msgs) {
    if (m.related_job_id) {
      const job = jobMap.get(m.related_job_id);
      if (job) {
        // direction=outbound (flex 送信) = "job_share"、 inbound (system) = "job_interest"
        items.push({
          kind: m.direction === "outbound" ? "job_share" : "job_interest",
          at: m.created_at,
          jobId: job.id,
          companyName: job.companyName,
          position: job.position,
        });
      }
    }
    if (m.related_meeting_schedule_id) {
      const meeting = meetingMap.get(m.related_meeting_schedule_id);
      if (meeting) {
        items.push({
          kind:
            meeting.status === "canceled"
              ? "meeting_canceled"
              : m.direction === "inbound" && m.message_type === "system"
                ? "meeting_confirmed"
                : "meeting_proposed",
          at: m.created_at,
          meetingId: meeting.id,
          title: meeting.title,
          startsAt: meeting.startsAt,
        });
      }
    }
  }

  // 同じ (kind, refId) で 古い ものは 除外 (job_share が 何度 も 出ない ように)
  const dedupedKey = new Set<string>();
  const deduped: ActivityItem[] = [];
  for (const item of items) {
    const refId = "jobId" in item ? item.jobId : "meetingId" in item ? item.meetingId : "";
    const key = `${item.kind}:${refId}`;
    if (dedupedKey.has(key)) continue;
    dedupedKey.add(key);
    deduped.push(item);
  }

  return NextResponse.json({ items: deduped });
}
