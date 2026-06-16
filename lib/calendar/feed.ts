/**
 * .ics 購読フィードのビルダ
 *
 * 配信内容:
 *   ・meeting_schedules(本人主催、starts_at が来月末まで、status != 'canceled')
 *   ・agency_tasks(本人担当 + 期限あり + status='pending'、due_at が来月末まで)
 *
 * 設計判断:
 *   ・期間は「今日 - 7日 〜 今日 + 60日」固定。
 *     購読カレンダーはキャッシュするので、長期間を返すと古い予定が残り続ける。
 *   ・1 つの VCALENDAR にまとめて返す(複数 VEVENT を順に並べる)。
 *   ・UID は安定値:`meeting:{uuid}@maira.pro` / `task:{uuid}@maira.pro`
 *   ・lib/calendar/ics.ts の buildIcsEvent を VEVENT 単位で使い、合体させる。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildIcsEvent } from "@/lib/calendar/ics";

export type FeedRange = { fromIso: string; toIso: string };

export function defaultFeedRange(now: Date = new Date()): FeedRange {
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

type MeetingRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  join_url: string;
  passcode: string | null;
  provider: "zoom" | "google_meet";
};

type TaskRow = {
  id: string;
  title: string;
  due_at: string;
};

export type FeedSources = {
  meetings: MeetingRow[];
  tasks: TaskRow[];
};

/**
 * 1 ユーザ分の .ics フィードソースを取得する(service_role 想定)。
 *
 * meeting_schedules は本人主催のみ、agency_tasks は assignee_member_id 経由で
 * 本人担当を引く。tasks 側はテーブル設計上「担当 = organization_members.user_id」
 * の二重 join が要るが、フィード用途では雑に「本人が assignee の member.id だけ」
 * を引く 1 段経路で十分。
 */
export async function loadFeedSources(
  service: SupabaseClient,
  userId: string,
  range: FeedRange,
): Promise<FeedSources> {
  const [{ data: meetings }, memberResult] = await Promise.all([
    service
      .from("meeting_schedules")
      .select("id, title, starts_at, ends_at, join_url, passcode, provider")
      .eq("host_user_id", userId)
      .neq("status", "canceled")
      .gte("starts_at", range.fromIso)
      .lte("starts_at", range.toIso)
      .order("starts_at", { ascending: true }),
    service.from("organization_members").select("id").eq("user_id", userId).maybeSingle(),
  ]);

  const memberId = (memberResult.data as { id: string } | null)?.id ?? null;

  let tasks: TaskRow[] = [];
  if (memberId) {
    const { data: taskRows } = await service
      .from("agency_tasks")
      .select("id, title, due_at, status, assignee_member_id")
      .eq("assignee_member_id", memberId)
      .eq("status", "pending")
      .not("due_at", "is", null)
      .gte("due_at", range.fromIso)
      .lte("due_at", range.toIso)
      .order("due_at", { ascending: true });
    tasks = ((taskRows as Array<{ id: string; title: string; due_at: string }> | null) ?? []).map(
      (t) => ({ id: t.id, title: t.title, due_at: t.due_at }),
    );
  }

  return {
    meetings: (meetings as MeetingRow[] | null) ?? [],
    tasks,
  };
}

/**
 * FeedSources を 1 本の VCALENDAR 文字列に組み立てる。
 *
 * 実装の単純化のため、VEVENT は buildIcsEvent() を 1 件ずつ呼んで、
 * BEGIN:VCALENDAR / END:VCALENDAR を 1 回だけにまとめる。
 */
export function buildIcsFeed(sources: FeedSources, now: Date = new Date()): string {
  const stamp = now;

  // 個別 VEVENT 文字列を作って、各々から VCALENDAR 包みを取り除いて連結する。
  const veventChunks: string[] = [];
  for (const m of sources.meetings) {
    const ics = buildIcsEvent({
      uid: `meeting:${m.id}@maira.pro`,
      summary: m.title,
      description: m.passcode
        ? `参加 URL: ${m.join_url}\nパスコード: ${m.passcode}`
        : `参加 URL: ${m.join_url}`,
      location: m.join_url,
      startsAt: m.starts_at,
      endsAt: m.ends_at,
      stamp,
      method: "PUBLISH",
    });
    veventChunks.push(extractVevent(ics));
  }
  for (const t of sources.tasks) {
    // タスクは 30 分ブロックで終了するダミー期間を持たせる(Google が time 表示に必要)
    const start = new Date(t.due_at);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const ics = buildIcsEvent({
      uid: `task:${t.id}@maira.pro`,
      summary: `[タスク] ${t.title}`,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      stamp,
      method: "PUBLISH",
    });
    veventChunks.push(extractVevent(ics));
  }

  const CRLF = "\r\n";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Maira//Calendar Feed//JA",
    "METHOD:PUBLISH",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Maira",
    ...veventChunks,
    "END:VCALENDAR",
  ];
  return lines.join(CRLF) + CRLF;
}

/**
 * buildIcsEvent() が返した VCALENDAR 全文から VEVENT 部分だけ取り出す。
 * BEGIN:VEVENT 〜 END:VEVENT の間を切り出す純関数。
 */
export function extractVevent(ics: string): string {
  const startIdx = ics.indexOf("BEGIN:VEVENT");
  const endIdx = ics.indexOf("END:VEVENT");
  if (startIdx < 0 || endIdx < 0) return "";
  return ics.slice(startIdx, endIdx + "END:VEVENT".length);
}
