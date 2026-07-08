/**
 * カレンダー画面用のイベント取得
 *
 * 組織内の日付ベースイベントを 1 つのリストにまとめる。
 *   - 面談予定 (client_records.first_meeting_date)
 *   - 受付日 (client_records.intake_date)
 *   - タスク期限 (agency_tasks.due_at) — 未完了のみ
 *   - 対応履歴 (client_interactions.occurred_at)
 *
 * パフォーマンス上は SQL 1 本に統合した方がよいが、テーブル間の RLS が
 * それぞれ独立しているので、別々に取って JS で集約する。
 */
import { createClient } from "@/lib/supabase/server";

import type { CalendarEvent } from "./types";

/**
 * 期間範囲は呼び出し側で指定(月単位ビューでは前月末〜翌月頭)。
 * UI 側で月切替時に再フェッチする想定。
 */
export type ListCalendarEventsOptions = {
  organizationId: string;
  /** ISO 形式または YYYY-MM-DD。含む。 */
  rangeStart: string;
  /** ISO 形式または YYYY-MM-DD。含む。 */
  rangeEnd: string;
};

function isoDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  // YYYY-MM-DDTHH:MM:SS / YYYY-MM-DD 両方を受け、頭 10 文字を切り出す。
  return iso.slice(0, 10);
}

export async function listCalendarEvents(
  opts: ListCalendarEventsOptions,
): Promise<CalendarEvent[]> {
  const supabase = await createClient();

  // 並列 で 5 ソース を 取得 (4 元 + 企業 面接 予定 = referrals)
  const [clientsRes, tasksRes, interactionsRes, meetingsRes, interviewsRes] = await Promise.all([
    supabase
      .from("client_records")
      .select("id, name, first_meeting_date, intake_date")
      .eq("organization_id", opts.organizationId)
      .or(
        `and(first_meeting_date.gte.${opts.rangeStart},first_meeting_date.lte.${opts.rangeEnd}),and(intake_date.gte.${opts.rangeStart},intake_date.lte.${opts.rangeEnd})`,
      ),
    supabase
      .from("agency_tasks")
      .select("id, title, due_at, status, client_record_id")
      .eq("organization_id", opts.organizationId)
      .eq("status", "pending")
      .gte("due_at", opts.rangeStart)
      .lte("due_at", opts.rangeEnd),
    supabase
      .from("client_interactions")
      .select("id, interaction_type, occurred_at, client_record_id, summary")
      .eq("organization_id", opts.organizationId)
      .gte("occurred_at", opts.rangeStart)
      .lte("occurred_at", opts.rangeEnd),
    // meeting_schedules: Zoom / Meet 経由 で 予約 した 面談 (キャンセル 以外)
    supabase
      .from("meeting_schedules")
      .select(
        "id, title, starts_at, ends_at, status, provider, join_url, client_record_id, invitee_name",
      )
      .eq("organization_id", opts.organizationId)
      .gte("starts_at", opts.rangeStart)
      .lte("starts_at", opts.rangeEnd + "T23:59:59")
      .neq("status", "canceled"),
    // 企業 と の 面接 予定 (referrals.scheduled_interview_at) + 関連 情報
    supabase
      .from("referrals")
      .select(
        "id, client_record_id, scheduled_interview_at, interview_note, status, job_postings ( company_name, position )",
      )
      .eq("organization_id", opts.organizationId)
      .gte("scheduled_interview_at", opts.rangeStart)
      .lte("scheduled_interview_at", opts.rangeEnd + "T23:59:59")
      .not("scheduled_interview_at", "is", null),
  ]);

  // クライアント名(タスク・対応履歴の表示用)を全件分先に Map 化する。
  // 期間外のクライアントもタスク経由で参照される可能性があるため、ここで一括取得。
  const clientNameMap = new Map<string, string>();
  if (clientsRes.data) {
    for (const c of clientsRes.data as Array<{ id: string; name: string }>) {
      clientNameMap.set(c.id, c.name);
    }
  }

  // タスク / 対応 履歴 側 に 未 収録 の クライアント が 居れば 追加 で 取得 する。
  const taskClientIds = (tasksRes.data ?? []).map(
    (t: { client_record_id: string }) => t.client_record_id,
  );
  const interactionClientIds = (interactionsRes.data ?? []).map(
    (i: { client_record_id: string }) => i.client_record_id,
  );
  const interviewClientIds = (interviewsRes.data ?? []).map(
    (r: { client_record_id: string }) => r.client_record_id,
  );
  const missingIds = Array.from(
    new Set([...taskClientIds, ...interactionClientIds, ...interviewClientIds]),
  ).filter((id) => !clientNameMap.has(id));
  if (missingIds.length > 0) {
    const { data: extra } = await supabase
      .from("client_records")
      .select("id, name")
      .in("id", missingIds);
    if (extra) {
      for (const c of extra as Array<{ id: string; name: string }>) {
        clientNameMap.set(c.id, c.name);
      }
    }
  }

  const events: CalendarEvent[] = [];

  // 1) 面談予定 + 受付日
  if (clientsRes.data) {
    for (const c of clientsRes.data as Array<{
      id: string;
      name: string;
      first_meeting_date: string | null;
      intake_date: string | null;
    }>) {
      if (c.first_meeting_date) {
        events.push({
          id: `first_meeting:${c.id}`,
          kind: "first_meeting",
          dateKey: c.first_meeting_date,
          occurredAt: null,
          title: "初回面談",
          clientRecordId: c.id,
          clientName: c.name,
        });
      }
      if (c.intake_date) {
        events.push({
          id: `intake:${c.id}`,
          kind: "intake",
          dateKey: c.intake_date,
          occurredAt: null,
          title: "受付",
          clientRecordId: c.id,
          clientName: c.name,
        });
      }
    }
  }

  // 2) タスク期限
  if (tasksRes.data) {
    for (const t of tasksRes.data as Array<{
      id: string;
      title: string;
      due_at: string | null;
      client_record_id: string;
    }>) {
      if (!t.due_at) continue;
      const dateKey = isoDateOnly(t.due_at);
      if (!dateKey) continue;
      events.push({
        id: `task:${t.id}`,
        kind: "task_due",
        dateKey,
        occurredAt: t.due_at,
        title: t.title,
        clientRecordId: t.client_record_id,
        clientName: clientNameMap.get(t.client_record_id) ?? "(顧客名未取得)",
      });
    }
  }

  // 3) 対応履歴
  if (interactionsRes.data) {
    for (const i of interactionsRes.data as Array<{
      id: string;
      interaction_type: string;
      occurred_at: string;
      client_record_id: string;
      summary: string | null;
    }>) {
      const dateKey = isoDateOnly(i.occurred_at);
      if (!dateKey) continue;
      const summary = i.summary && i.summary.trim() !== "" ? i.summary : i.interaction_type;
      events.push({
        id: `interaction:${i.id}`,
        kind: "interaction",
        dateKey,
        occurredAt: i.occurred_at,
        title: summary,
        clientRecordId: i.client_record_id,
        clientName: clientNameMap.get(i.client_record_id) ?? "(顧客名未取得)",
      });
    }
  }

  // 4) Zoom / Meet 面談予約(meeting_schedules)
  if (meetingsRes.data) {
    // 不足クライアント名を追加で引く
    const meetingClientIds = (meetingsRes.data as Array<{ client_record_id: string | null }>)
      .map((m) => m.client_record_id)
      .filter((v): v is string => Boolean(v) && !clientNameMap.has(v!));
    if (meetingClientIds.length > 0) {
      const { data: extraClients } = await supabase
        .from("client_records")
        .select("id, name")
        .in("id", Array.from(new Set(meetingClientIds)));
      if (extraClients) {
        for (const c of extraClients as Array<{ id: string; name: string }>) {
          clientNameMap.set(c.id, c.name);
        }
      }
    }
    for (const m of meetingsRes.data as Array<{
      id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      provider: "zoom" | "google_meet";
      join_url: string;
      client_record_id: string | null;
      invitee_name: string | null;
    }>) {
      const dateKey = isoDateOnly(m.starts_at);
      if (!dateKey) continue;
      // 表示 名 の 優先 順:
      //   1. client_records 連携 済 → 顧客名
      //   2. invitee_name (LINE 友達 名 等) が ある → それ
      //   3. fallback → provider 名 ("Zoom" / "Google Meet")
      const displayName = m.client_record_id
        ? (clientNameMap.get(m.client_record_id) ?? "(顧客名未取得)")
        : (m.invitee_name ?? (m.provider === "zoom" ? "Zoom" : "Google Meet"));
      events.push({
        id: `meeting:${m.id}`,
        kind: "meeting",
        dateKey,
        occurredAt: m.starts_at,
        title: m.title,
        clientRecordId: m.client_record_id,
        clientName: displayName,
        meetingScheduleId: m.id,
        joinUrl: m.join_url,
        endsAt: m.ends_at,
      });
    }
  }

  // 5) 企業 と の 面接 予定 (referrals.scheduled_interview_at)
  if (interviewsRes.data) {
    type InterviewRow = {
      id: string;
      client_record_id: string;
      scheduled_interview_at: string;
      interview_note: string | null;
      status: string;
      job_postings:
        | { company_name: string; position: string }
        | { company_name: string; position: string }[]
        | null;
    };
    for (const r of interviewsRes.data as InterviewRow[]) {
      const dateKey = isoDateOnly(r.scheduled_interview_at);
      if (!dateKey) continue;
      const job = Array.isArray(r.job_postings) ? r.job_postings[0] : r.job_postings;
      const companyName = job?.company_name ?? "(求人 削除 済)";
      const position = job?.position ?? "";
      const displayName = clientNameMap.get(r.client_record_id) ?? "(顧客名 未取得)";
      const title = position ? `${companyName} ・ ${position}` : companyName;
      events.push({
        id: `company_interview:${r.id}`,
        kind: "company_interview",
        dateKey,
        occurredAt: r.scheduled_interview_at,
        title,
        clientRecordId: r.client_record_id,
        clientName: displayName,
        companyName,
        jobPosition: position,
        interviewNote: r.interview_note ?? undefined,
      });
    }
  }

  // dateKey 昇順 → 同 日内 は kind 優先。 company_interview は 「今日 やる こと」 と して
  // meeting と 同 等 に 目立たせる ため 上位 に。
  const KIND_ORDER: Record<string, number> = {
    meeting: 0,
    company_interview: 1,
    first_meeting: 2,
    task_due: 3,
    intake: 4,
    interaction: 5,
    external_google: 6,
  };
  events.sort((a, b) => {
    const dc = a.dateKey.localeCompare(b.dateKey);
    if (dc !== 0) return dc;
    return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
  });

  return events;
}
