/**
 * クライアント活動タイムライン構築(純関数、副作用ゼロ)
 *
 * 個別に存在する「対応履歴 / タスク / 応募 / 応募ステータス遷移 / 連携状態変化」を
 * 1 本の時系列イベント配列にまとめる。CRM の「顧客 360° ビュー」の中核。
 *
 * 設計方針:
 *   - 全て pure。入力に依存して出力が決まる(テストしやすい)。
 *   - actorName が解決できないソース(タイムアウト経由の自動 revoked 等)は null。
 *   - 並びは occurredAt の降順(最新が先頭)。同時刻は kind の優先順で安定ソート。
 *   - ここで日本語ラベル化までやる。UI 側は ActivityEvent 配列を描画するだけ。
 */
import type { ClientInteractionWithAuthor, InteractionType } from "@/lib/interactions/types";
import { getInteractionTypeConfig } from "@/lib/interactions/types";
import type { AgencyTaskWithAssignee } from "@/lib/agency-tasks/types";
import type { ReferralStatusHistory, ReferralStatus, ReferralWithJob } from "@/lib/referrals/types";
import { getReferralStatusConfig } from "@/lib/referrals/types";
import type { ClientRecord } from "./types";

export type ActivityEventKind =
  | "interaction"
  | "task_created"
  | "task_completed"
  | "referral_created"
  | "referral_status_changed"
  | "client_linked"
  | "client_revoke_requested"
  | "client_revoked";

export type ActivityEventColor = "blue" | "amber" | "purple" | "green" | "red" | "gray" | "slate";

export type ActivityEvent = {
  id: string; // React key 用に kind + 元 id を連結
  kind: ActivityEventKind;
  /** イベントの実発生時刻(ソート / 表示の両方で使う) */
  occurredAt: string;
  /** 誰がやったか(自動処理は null) */
  actorName: string | null;
  /** 1 行見出し(例:「電話による対応」「タスク作成: ○○」) */
  title: string;
  /** 補足の本文。null なら見出しのみ */
  detail: string | null;
  /** バッジ用の系統ラベル(タグ表示用、UI 側で色マップに引く) */
  badgeLabel: string;
  /** UI 側で色付けに使うヒント */
  color: ActivityEventColor;
};

/**
 * kind ごとの相対優先(同時刻の安定ソート用)。
 * 同じ秒に起きた task_created と task_completed は両方を見せたいので、
 * created を上に来るよう若い値を割り当てる。
 */
const KIND_ORDER: Record<ActivityEventKind, number> = {
  interaction: 1,
  referral_status_changed: 2,
  referral_created: 3,
  task_completed: 4,
  task_created: 5,
  client_linked: 6,
  client_revoke_requested: 7,
  client_revoked: 8,
};

const INTERACTION_COLOR: Record<InteractionType, ActivityEventColor> = {
  call: "blue",
  email: "blue",
  meeting: "purple",
  message: "blue",
  note: "gray",
  other: "slate",
};

export type BuildActivityTimelineInput = {
  client: Pick<
    ClientRecord,
    "linkStatus" | "linkedAt" | "revokeRequestedAt" | "revokedAt" | "revokeConfirmedVia"
  >;
  interactions: ClientInteractionWithAuthor[];
  tasks: AgencyTaskWithAssignee[];
  referrals: ReferralWithJob[];
  /** 応募 ID → 履歴(古い順 or 新しい順、どちらでも OK。ここで都度ソート) */
  historiesByReferral: Map<string, ReferralStatusHistory[]>;
  /** 履歴の changedByMemberId を表示名に変換する Map(authorName と同じ仕組み) */
  memberNameById?: Map<string, string | null>;
};

/**
 * 入力ソースから ActivityEvent[] を構築する。
 * 出力は occurredAt 降順 → KIND_ORDER 昇順 で安定ソート済み。
 */
export function buildActivityTimeline(input: BuildActivityTimelineInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  // 1) 対応履歴(interactions)
  for (const it of input.interactions) {
    const cfg = getInteractionTypeConfig(it.interactionType);
    const title = it.summary && it.summary.trim() !== "" ? it.summary : `${cfg.label}による対応`;
    events.push({
      id: `interaction:${it.id}`,
      kind: "interaction",
      occurredAt: it.occurredAt,
      actorName: it.authorName,
      title,
      detail: it.body && it.body.trim() !== "" ? it.body : null,
      badgeLabel: cfg.label,
      color: INTERACTION_COLOR[it.interactionType],
    });
  }

  // 2) タスク(作成 + 完了 を別イベントとして扱う)
  for (const t of input.tasks) {
    events.push({
      id: `task_created:${t.id}`,
      kind: "task_created",
      occurredAt: t.createdAt,
      actorName: t.assigneeName,
      title: `タスク作成: ${t.title}`,
      detail: t.dueAt ? `期限: ${formatDateOnly(t.dueAt)}` : null,
      badgeLabel: "タスク",
      color: "amber",
    });
    if (t.status === "completed" && t.completedAt) {
      events.push({
        id: `task_completed:${t.id}`,
        kind: "task_completed",
        occurredAt: t.completedAt,
        actorName: t.assigneeName,
        title: `タスク完了: ${t.title}`,
        detail: null,
        badgeLabel: "完了",
        color: "green",
      });
    }
  }

  // 3) 応募作成 + 応募ステータス遷移
  for (const r of input.referrals) {
    events.push({
      id: `referral_created:${r.id}`,
      kind: "referral_created",
      occurredAt: r.createdAt,
      actorName: null, // 作成者の member 表示名は referrals 型にないので null。
      title: `応募登録: ${r.jobCompanyName} / ${r.jobPosition}`,
      detail: r.notes && r.notes.trim() !== "" ? r.notes : null,
      badgeLabel: "応募",
      color: "purple",
    });

    const histories = input.historiesByReferral.get(r.id) ?? [];
    for (const h of histories) {
      const fromLabel = h.fromStatus ? getReferralStatusConfig(h.fromStatus).label : "—";
      const toLabel = getReferralStatusConfig(h.toStatus).label;
      const actorName = h.changedByMemberId
        ? (input.memberNameById?.get(h.changedByMemberId) ?? null)
        : null;
      events.push({
        id: `referral_status_changed:${h.id}`,
        kind: "referral_status_changed",
        occurredAt: h.changedAt,
        actorName,
        title: `応募ステータス: ${fromLabel} → ${toLabel}(${r.jobCompanyName})`,
        detail: h.memo && h.memo.trim() !== "" ? h.memo : null,
        badgeLabel: "選考",
        color: colorForReferralStatus(h.toStatus),
      });
    }
  }

  // 4) 連携状態の変化(client_records 上のタイムスタンプを直接使う)
  if (input.client.linkedAt) {
    events.push({
      id: "client_linked",
      kind: "client_linked",
      occurredAt: input.client.linkedAt,
      actorName: null,
      title: "Maira アカウントと連携開始",
      detail: null,
      badgeLabel: "連携",
      color: "green",
    });
  }
  if (input.client.revokeRequestedAt) {
    events.push({
      id: "client_revoke_requested",
      kind: "client_revoke_requested",
      occurredAt: input.client.revokeRequestedAt,
      actorName: null,
      title: "求職者から連携解除の申請",
      detail: null,
      badgeLabel: "申請",
      color: "amber",
    });
  }
  if (input.client.revokedAt) {
    const viaLabel =
      input.client.revokeConfirmedVia === "agency_approved"
        ? "エージェント承認"
        : input.client.revokeConfirmedVia === "timeout"
          ? "猶予期限超過"
          : null;
    events.push({
      id: "client_revoked",
      kind: "client_revoked",
      occurredAt: input.client.revokedAt,
      actorName: null,
      title: viaLabel ? `連携解除確定(${viaLabel})` : "連携解除確定",
      detail: null,
      badgeLabel: "解除",
      color: "red",
    });
  }

  // ソート:時刻降順 → 同時刻は KIND_ORDER 昇順
  events.sort((a, b) => {
    const cmp = b.occurredAt.localeCompare(a.occurredAt);
    if (cmp !== 0) return cmp;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  return events;
}

/**
 * 応募ステータス遷移の色付け。営業ポジティブ(内定 / 入社)は緑、
 * 撤退(見送り)は赤、中盤の選考(書類 / 面接)は紫、初期は青。
 */
function colorForReferralStatus(status: ReferralStatus): ActivityEventColor {
  switch (status) {
    case "joined":
    case "offer":
      return "green";
    case "declined":
      return "red";
    case "interview":
    case "screening":
      return "purple";
    case "recommended":
    case "planned":
    default:
      return "blue";
  }
}

/** "YYYY-MM-DD" or ISO → "2026/06/14" の日本ロケール表記 */
function formatDateOnly(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP");
  } catch {
    return iso;
  }
}
