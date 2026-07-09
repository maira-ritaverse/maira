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

import {
  buildSuppressKeys,
  INTERVIEW_ROUND_LABEL,
  shouldSuppressReferral,
} from "./interview-dedupe";
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

  // 並列 で 7 ソース を 取得:
  //   1. client_records (初回面談 / 受付)
  //   2. agency_tasks (期限)
  //   3. client_interactions (対応履歴)
  //   4. meeting_schedules (Zoom/Meet 面談)
  //   5. referrals (企業面接 の 直近 1 件 デノーマライズ、 status で 除外 = A)
  //   6. interviews (1 応募 × N 回 の 個別 ラウンド、 B)
  //   7. line_meeting_proposals (LINE 未 確定 候補、 candidates jsonb を fan-out = C)
  const [
    clientsRes,
    tasksRes,
    interactionsRes,
    meetingsRes,
    interviewsRes,
    interviewRoundsRes,
    lineProposalsRes,
  ] = await Promise.all([
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
        "id, title, starts_at, ends_at, status, provider, join_url, client_record_id, invitee_name, recording_planned, recording_id",
      )
      .eq("organization_id", opts.organizationId)
      .gte("starts_at", opts.rangeStart)
      .lte("starts_at", opts.rangeEnd + "T23:59:59")
      .neq("status", "canceled"),
    // 企業 と の 面接 予定 (referrals.scheduled_interview_at) + 関連 情報。
    // A: declined / joined になった 案件 は 「幽霊 予定」 化 する ので 除外。
    // 内定 回答 期限 (offer_deadline_at) も 一緒 に 取得 し 「offer_deadline」 kind
    // として 別 event を 生成 する (同じ referral 行 を 2 回 SELECT する 無駄 を 避ける)。
    supabase
      .from("referrals")
      .select(
        "id, client_record_id, scheduled_interview_at, interview_note, status, offer_deadline_at, job_postings ( company_name, position )",
      )
      .eq("organization_id", opts.organizationId)
      .or(
        `and(scheduled_interview_at.gte.${opts.rangeStart},scheduled_interview_at.lte.${opts.rangeEnd}T23:59:59),and(offer_deadline_at.gte.${opts.rangeStart},offer_deadline_at.lte.${opts.rangeEnd}T23:59:59)`,
      )
      .not("status", "in", "(declined,joined)"),
    // B: interviews (1 応募 × 複数 面接 ラウンド の 個別 レコード)。
    // result = 'scheduled' のみ を カレンダー に 出す (done / canceled / no_show は 過去 履歴)。
    // referral 経由 で 会社名 と 求職者 情報 を join。
    supabase
      .from("interviews")
      .select(
        "id, referral_id, kind, scheduled_at, result, notes, referrals ( client_record_id, job_postings ( company_name, position ) )",
      )
      .eq("organization_id", opts.organizationId)
      .eq("result", "scheduled")
      .gte("scheduled_at", opts.rangeStart)
      .lte("scheduled_at", opts.rangeEnd + "T23:59:59"),
    // C: line_meeting_proposals (LINE で 提案 中 の 未 確定 スロット)。
    // consumed_at IS NULL AND expires_at > now() で 「まだ 生きて いる 提案」 を 引き、
    // candidates jsonb 配列 を アプリ側 で fan-out する。
    supabase
      .from("line_meeting_proposals")
      .select("id, client_record_id, title, candidates, expires_at, duration_minutes")
      .eq("organization_id", opts.organizationId)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()),
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
  // B: interviews (ラウンド) の client_record_id は referrals ネスト 経由 で 取得。
  type InterviewRoundRow = {
    id: string;
    referral_id: string;
    kind: "first" | "second" | "final" | "offer" | "company";
    scheduled_at: string;
    result: "scheduled" | "done" | "canceled" | "no_show";
    notes: string | null;
    referrals:
      | {
          client_record_id: string | null;
          job_postings:
            | { company_name: string; position: string }
            | { company_name: string; position: string }[]
            | null;
        }
      | Array<{
          client_record_id: string | null;
          job_postings:
            | { company_name: string; position: string }
            | { company_name: string; position: string }[]
            | null;
        }>
      | null;
  };
  const roundClientIds: string[] = [];
  for (const r of (interviewRoundsRes.data ?? []) as InterviewRoundRow[]) {
    const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
    if (ref?.client_record_id) roundClientIds.push(ref.client_record_id);
  }
  // C: line_meeting_proposals の client_record_id を 収集。
  const proposalClientIds = (
    (lineProposalsRes.data ?? []) as Array<{
      client_record_id: string | null;
    }>
  )
    .map((p) => p.client_record_id)
    .filter((v): v is string => Boolean(v));
  const missingIds = Array.from(
    new Set([
      ...taskClientIds,
      ...interactionClientIds,
      ...interviewClientIds,
      ...roundClientIds,
      ...proposalClientIds,
    ]),
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
      recording_planned: boolean | null;
      recording_id: string | null;
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
      // 録音 状態:
      //   ・recording_id が セット されて いれば "recorded" (アップロード 済)
      //   ・recording_planned が true なら "planned" (予約 のみ)
      //   ・どちら も 無ければ null (表示 抑制)
      const recordingState: "planned" | "recorded" | null = m.recording_id
        ? "recorded"
        : m.recording_planned
          ? "planned"
          : null;
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
        recordingState,
        recordingId: m.recording_id,
      });
    }
  }

  // B: interviews (個別 ラウンド) を 先 に 展開 し、 dedupe キー を 作成。
  //   ・referrals.scheduled_interview_at は 「直近 1 件」 の デノーマライズ 版 な ので、
  //     interviews に 同一 referral の 同時刻 (±5 分) レコード が あれば、
  //     interviews 側 を 優先 し referrals の company_interview を 抑制 する。
  //   ・こう する ことで 「1 応募 の 1 次 と 2 次 を 別 日 で 表示」 が 可能 に なり、
  //     かつ 「同 じ 予定 を 2 回 描画」 も 防げる。
  // dedupe: referral_id + 分単位 の epoch → 1 つ の interview_round が 覆う。
  // ロジック は lib/calendar/interview-dedupe.ts に 純粋 関数 化 (テスト 付き)。
  const roundSuppressKeys = buildSuppressKeys(
    ((interviewRoundsRes.data ?? []) as InterviewRoundRow[]).map((r) => ({
      referralId: r.referral_id,
      scheduledAt: r.scheduled_at,
    })),
  );
  if (interviewRoundsRes.data) {
    for (const r of interviewRoundsRes.data as InterviewRoundRow[]) {
      const dateKey = isoDateOnly(r.scheduled_at);
      if (!dateKey) continue;
      const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
      const clientRecordId = ref?.client_record_id ?? null;
      const job = ref?.job_postings
        ? Array.isArray(ref.job_postings)
          ? ref.job_postings[0]
          : ref.job_postings
        : null;
      const companyName = job?.company_name ?? "(求人 削除 済)";
      const position = job?.position ?? "";
      const displayName = clientRecordId
        ? (clientNameMap.get(clientRecordId) ?? "(顧客名 未取得)")
        : "(顧客名 未取得)";
      const roundLabel = INTERVIEW_ROUND_LABEL[r.kind];
      const title = position
        ? `${roundLabel}: ${companyName} ・ ${position}`
        : `${roundLabel}: ${companyName}`;
      events.push({
        id: `interview_round:${r.id}`,
        kind: "interview_round",
        dateKey,
        occurredAt: r.scheduled_at,
        title,
        clientRecordId,
        clientName: displayName,
        companyName,
        jobPosition: position,
        interviewNote: r.notes ?? undefined,
        roundLabel,
      });
    }
  }

  // 5) 企業 と の 面接 予定 (referrals.scheduled_interview_at) + 内定 回答 期限 (offer_deadline_at)
  //    interview_round と 重複 する レコード は 抑制 (dedupe)。
  if (interviewsRes.data) {
    type InterviewRow = {
      id: string;
      client_record_id: string;
      scheduled_interview_at: string | null;
      interview_note: string | null;
      status: string;
      offer_deadline_at: string | null;
      job_postings:
        | { company_name: string; position: string }
        | { company_name: string; position: string }[]
        | null;
    };
    for (const r of interviewsRes.data as InterviewRow[]) {
      const job = Array.isArray(r.job_postings) ? r.job_postings[0] : r.job_postings;
      const companyName = job?.company_name ?? "(求人 削除 済)";
      const position = job?.position ?? "";
      const displayName = clientNameMap.get(r.client_record_id) ?? "(顧客名 未取得)";
      const jobTitle = position ? `${companyName} ・ ${position}` : companyName;

      // 5a. 面接 予定 (scheduled_interview_at)
      if (r.scheduled_interview_at) {
        const dateKey = isoDateOnly(r.scheduled_interview_at);
        // dedupe: 同一 referral の interview_round が ± 5 分 以内 に あれば 抑制
        if (
          dateKey &&
          !shouldSuppressReferral(
            { id: r.id, scheduledInterviewAt: r.scheduled_interview_at },
            roundSuppressKeys,
          )
        ) {
          events.push({
            id: `company_interview:${r.id}`,
            kind: "company_interview",
            dateKey,
            occurredAt: r.scheduled_interview_at,
            title: jobTitle,
            clientRecordId: r.client_record_id,
            clientName: displayName,
            companyName,
            jobPosition: position,
            interviewNote: r.interview_note ?? undefined,
          });
        }
      }

      // 5b. 内定 回答 期限 (offer_deadline_at) — 別 kind = 'offer_deadline'
      if (r.offer_deadline_at) {
        const deadlineKey = isoDateOnly(r.offer_deadline_at);
        if (deadlineKey) {
          events.push({
            id: `offer_deadline:${r.id}`,
            kind: "offer_deadline",
            dateKey: deadlineKey,
            occurredAt: r.offer_deadline_at,
            title: `内定 回答 期限: ${jobTitle}`,
            clientRecordId: r.client_record_id,
            clientName: displayName,
            companyName,
            jobPosition: position,
          });
        }
      }
    }
  }

  // C: line_meeting_proposals (未 確定 の 面談 候補) を fan-out。
  //    candidates jsonb は [{ startsAt, endsAt }, ...] 配列。 各 slot を 別 CalendarEvent 化。
  //    proposal 単位 で 候補 数 が 多い (通常 3 件) 為、 4 件 以上 の 候補 は 描画 しない (視認性)。
  if (lineProposalsRes.data) {
    type ProposalRow = {
      id: string;
      client_record_id: string | null;
      title: string;
      candidates: unknown;
      expires_at: string;
      duration_minutes: number;
    };
    for (const p of lineProposalsRes.data as ProposalRow[]) {
      if (!Array.isArray(p.candidates)) continue;
      const displayName = p.client_record_id
        ? (clientNameMap.get(p.client_record_id) ?? "(顧客名 未取得)")
        : "(未 紐付け)";
      // 最大 4 スロット まで 描画 (通常 は 3 件 だが 予備 で 4 まで 許容)
      for (let i = 0; i < Math.min(p.candidates.length, 4); i++) {
        const slot = p.candidates[i] as { startsAt?: string; endsAt?: string };
        if (!slot?.startsAt) continue;
        const dateKey = isoDateOnly(slot.startsAt);
        if (!dateKey) continue;
        events.push({
          id: `meeting_tentative:${p.id}:${i}`,
          kind: "meeting_tentative",
          dateKey,
          occurredAt: slot.startsAt,
          endsAt: slot.endsAt ?? undefined,
          title: p.title,
          clientRecordId: p.client_record_id,
          clientName: displayName,
          proposalId: p.id,
          proposalSlotIndex: i,
        });
      }
    }
  }

  // dateKey 昇順 → 同 日内 は kind 優先。 interview_round を 最上位 に、
  // meeting_tentative は 「未 確定」 な ので 通常 会議 より 下位 に 配置。
  // offer_deadline は 「今日 中 に アクション しないと 内定 が 消える」 = 最重要 な ので
  // interview_round より 上位 に 置く。
  const KIND_ORDER: Record<string, number> = {
    offer_deadline: 0,
    interview_round: 1,
    meeting: 2,
    company_interview: 3,
    meeting_tentative: 4,
    first_meeting: 5,
    task_due: 6,
    intake: 7,
    interaction: 8,
    external_google: 9,
  };
  events.sort((a, b) => {
    const dc = a.dateKey.localeCompare(b.dateKey);
    if (dc !== 0) return dc;
    return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
  });

  return events;
}
