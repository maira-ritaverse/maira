/**
 * activity-timeline.ts のテスト
 *
 * 純関数 buildActivityTimeline の挙動を網羅する。
 * - 各ソースの取り込み(interactions / tasks / referrals / histories / link 状態)
 * - 並び順(時刻降順 + 同時刻の KIND_ORDER 安定ソート)
 * - actorName の解決(memberNameById 経由 / null)
 * - エッジ:空入力 / detail の空文字 → null / interaction の summary 空文字 → 種別ラベル
 */
import { describe, expect, it } from "vitest";

import { buildActivityTimeline, type BuildActivityTimelineInput } from "./activity-timeline";
import type { ClientInteractionWithAuthor } from "@/lib/interactions/types";
import type { AgencyTaskWithAssignee } from "@/lib/agency-tasks/types";
import type { ReferralStatusHistory, ReferralWithJob } from "@/lib/referrals/types";

const baseClient: BuildActivityTimelineInput["client"] = {
  linkStatus: "unlinked",
  linkedAt: null,
  revokeRequestedAt: null,
  revokedAt: null,
  revokeConfirmedVia: null,
};

function emptyInput(): BuildActivityTimelineInput {
  return {
    client: baseClient,
    interactions: [],
    tasks: [],
    referrals: [],
    historiesByReferral: new Map(),
  };
}

function interaction(
  overrides: Partial<ClientInteractionWithAuthor> = {},
): ClientInteractionWithAuthor {
  return {
    id: "int-1",
    organizationId: "org-1",
    clientRecordId: "client-1",
    referralId: null,
    authorMemberId: "mem-1",
    interactionType: "call",
    occurredAt: "2026-06-10T10:00:00.000Z",
    summary: "電話で進捗確認",
    body: "詳細メモ",
    createdAt: "2026-06-10T10:01:00.000Z",
    updatedAt: "2026-06-10T10:01:00.000Z",
    authorName: "山田太郎",
    ...overrides,
  };
}

function task(overrides: Partial<AgencyTaskWithAssignee> = {}): AgencyTaskWithAssignee {
  return {
    id: "task-1",
    organizationId: "org-1",
    clientRecordId: "client-1",
    referralId: null,
    assignedMemberId: "mem-1",
    title: "履歴書レビュー",
    status: "pending",
    priority: "normal",
    dueAt: null,
    completedAt: null,
    createdAt: "2026-06-09T09:00:00.000Z",
    updatedAt: "2026-06-09T09:00:00.000Z",
    assigneeName: "鈴木花子",
    assigneeAvatarUrl: null,
    ...overrides,
  };
}

function referral(overrides: Partial<ReferralWithJob> = {}): ReferralWithJob {
  return {
    id: "ref-1",
    organizationId: "org-1",
    clientRecordId: "client-1",
    jobPostingId: "job-1",
    status: "planned",
    notes: null,
    createdAt: "2026-06-08T08:00:00.000Z",
    updatedAt: "2026-06-08T08:00:00.000Z",
    jobCompanyName: "サンプル株式会社",
    jobPosition: "Webエンジニア",
    ...overrides,
  };
}

function history(overrides: Partial<ReferralStatusHistory> = {}): ReferralStatusHistory {
  return {
    id: "hist-1",
    organizationId: "org-1",
    referralId: "ref-1",
    fromStatus: "planned",
    toStatus: "recommended",
    changedByMemberId: "mem-1",
    changedAt: "2026-06-09T12:00:00.000Z",
    memo: null,
    createdAt: "2026-06-09T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildActivityTimeline", () => {
  it("空入力は空配列を返す", () => {
    expect(buildActivityTimeline(emptyInput())).toEqual([]);
  });

  it("interaction はそのまま 1 件のイベントになる", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      interactions: [interaction()],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "interaction",
      occurredAt: "2026-06-10T10:00:00.000Z",
      actorName: "山田太郎",
      title: "電話で進捗確認",
      detail: "詳細メモ",
      badgeLabel: "電話",
      color: "blue",
    });
  });

  it("interaction の summary が空文字なら種別ラベルにフォールバック", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      interactions: [interaction({ summary: "" })],
    });
    expect(r[0].title).toBe("電話による対応");
  });

  it("interaction の body が空文字なら detail は null", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      interactions: [interaction({ body: "" })],
    });
    expect(r[0].detail).toBeNull();
  });

  it("interaction の種別ごとに color が変わる", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      interactions: [
        interaction({ id: "a", interactionType: "meeting", occurredAt: "2026-06-10T01:00:00Z" }),
        interaction({ id: "b", interactionType: "note", occurredAt: "2026-06-10T02:00:00Z" }),
      ],
    });
    const meeting = r.find((e) => e.id.endsWith("a"));
    const note = r.find((e) => e.id.endsWith("b"));
    expect(meeting?.color).toBe("purple");
    expect(note?.color).toBe("gray");
  });

  it("task は作成イベントを 1 件出す(未完了)", () => {
    const r = buildActivityTimeline({ ...emptyInput(), tasks: [task()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "task_created",
      title: "タスク作成: 履歴書レビュー",
      badgeLabel: "タスク",
      color: "amber",
    });
  });

  it("task に dueAt があれば detail に期限を入れる", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      tasks: [task({ dueAt: "2026-06-20T00:00:00.000Z" })],
    });
    expect(r[0].detail).toMatch(/期限:/);
  });

  it("task が completed なら作成 + 完了の 2 件出す", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      tasks: [
        task({
          status: "completed",
          completedAt: "2026-06-11T10:00:00.000Z",
        }),
      ],
    });
    expect(r).toHaveLength(2);
    // 時刻降順なので completed が先頭
    expect(r[0].kind).toBe("task_completed");
    expect(r[1].kind).toBe("task_created");
  });

  it("task が completed でも completedAt が null なら完了イベントは出さない", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      tasks: [task({ status: "completed", completedAt: null })],
    });
    expect(r.filter((e) => e.kind === "task_completed")).toHaveLength(0);
  });

  it("referral は作成イベントを出す(企業名 + ポジション)", () => {
    const r = buildActivityTimeline({ ...emptyInput(), referrals: [referral()] });
    expect(r[0].title).toBe("応募登録: サンプル株式会社 / Webエンジニア");
    expect(r[0].badgeLabel).toBe("応募");
  });

  it("referral_status_history は memberNameById で解決する", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      referrals: [referral()],
      historiesByReferral: new Map([["ref-1", [history()]]]),
      memberNameById: new Map([["mem-1", "山田太郎"]]),
    });
    const transition = r.find((e) => e.kind === "referral_status_changed");
    expect(transition?.actorName).toBe("山田太郎");
    expect(transition?.title).toMatch(/予定 → 推薦/);
  });

  it("referral_status_history の changedByMemberId が null なら actorName も null", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      referrals: [referral()],
      historiesByReferral: new Map([["ref-1", [history({ changedByMemberId: null })]]]),
    });
    const transition = r.find((e) => e.kind === "referral_status_changed");
    expect(transition?.actorName).toBeNull();
  });

  it("内定 / 見送り は色が変わる", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      referrals: [referral()],
      historiesByReferral: new Map([
        [
          "ref-1",
          [
            history({ id: "h1", toStatus: "offer", changedAt: "2026-06-11T01:00:00Z" }),
            history({ id: "h2", toStatus: "declined", changedAt: "2026-06-11T02:00:00Z" }),
          ],
        ],
      ]),
    });
    const offer = r.find((e) => e.id === "referral_status_changed:h1");
    const declined = r.find((e) => e.id === "referral_status_changed:h2");
    expect(offer?.color).toBe("green");
    expect(declined?.color).toBe("red");
  });

  it("連携状態の各タイムスタンプはイベントになる", () => {
    const r = buildActivityTimeline({
      ...emptyInput(),
      client: {
        linkStatus: "revoked",
        linkedAt: "2026-06-01T00:00:00.000Z",
        revokeRequestedAt: "2026-06-05T00:00:00.000Z",
        revokedAt: "2026-06-12T00:00:00.000Z",
        revokeConfirmedVia: "timeout",
      },
    });
    const kinds = r.map((e) => e.kind);
    expect(kinds).toContain("client_linked");
    expect(kinds).toContain("client_revoke_requested");
    expect(kinds).toContain("client_revoked");
    const revoked = r.find((e) => e.kind === "client_revoked");
    expect(revoked?.title).toMatch(/猶予期限超過/);
  });

  it("時刻降順 + 同時刻は KIND_ORDER 昇順で安定ソートされる", () => {
    const sameTime = "2026-06-10T00:00:00.000Z";
    const r = buildActivityTimeline({
      ...emptyInput(),
      interactions: [interaction({ id: "i1", occurredAt: sameTime, summary: "intr" })],
      tasks: [
        task({ id: "t1", createdAt: sameTime, title: "created" }),
        task({
          id: "t2",
          createdAt: "2026-06-09T00:00:00.000Z",
          status: "completed",
          completedAt: sameTime,
          title: "completed",
        }),
      ],
    });
    // 同時刻 4 件 + 古い 1 件(t2 の createdAt)。
    // KIND_ORDER は interaction(1) < task_completed(4) < task_created(5)。
    const sameTimeEvents = r.filter((e) => e.occurredAt === sameTime);
    expect(sameTimeEvents.map((e) => e.kind)).toEqual([
      "interaction",
      "task_completed",
      "task_created",
    ]);
    // 古いイベントが末尾にいる
    expect(r[r.length - 1].occurredAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("入力配列を破壊しない", () => {
    const ints = [interaction()];
    const orig = [...ints];
    buildActivityTimeline({ ...emptyInput(), interactions: ints });
    expect(ints).toEqual(orig);
  });
});
