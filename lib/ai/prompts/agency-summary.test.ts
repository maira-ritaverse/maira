import { describe, it, expect } from "vitest";
import {
  AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT,
  buildAgencyClientSummaryPrompt,
} from "./agency-summary";
import type { ClientRecord } from "@/lib/clients/types";
import type { DisclosableProfile } from "@/lib/connections/disclosable-profile";
import type { AgencyTaskWithAssignee } from "@/lib/agency-tasks/types";
import type { ClientInteractionWithAuthor } from "@/lib/interactions/types";
import type { PlacementWithAuthor } from "@/lib/placements/types";
import type { ReferralStatusHistoryWithAuthor, ReferralWithJob } from "@/lib/referrals/types";

/**
 * エージェント向けクライアントサマリープロンプトのテスト。
 *
 * 開示境界(最重要):
 *   - DisclosableProfile 型に限定し、内面(strengths/values/concerns/summary/diagnosis)は
 *     型レベルで含まれない契約。
 *   - エージェント内部メモは AI に「内部メモ」と明示して渡す。
 *
 * 出力構造:
 *   - 各セクション(referrals/interactions/placements/tasks/disclosableProfile)は
 *     データがある時だけ出る(空ならセクション自体省略)。
 *   - body は 400 文字でトリムされる(長文化を避ける)。
 *
 * SYSTEM プロンプトの「事実ベース」「2 セクション Markdown」契約も検証。
 */

const baseClient: ClientRecord = {
  id: "c1",
  organizationId: "o1",
  assignedMemberId: null,
  name: "田中太郎",
  email: "tanaka@example.com",
  phone: null,
  status: "job_matching",
  linkStatus: "linked",
  linkedUserId: null,
  linkedAt: null,
  revokedAt: null,
  revokeRequestedAt: null,
  revokeDeadline: null,
  revokeConfirmedVia: null,
  notes: null,
  closeReason: null,
  emailDistributionEnabled: true,
  entrySite: null,
  hasOtherAgencyStatus: false,
  // EMPRO 名簿拡張(マイグレーション 20260615100001)。テストでは全て null/空で固定。
  nameKana: null,
  birthDate: null,
  gender: null,
  nationality: null,
  maritalStatus: null,
  postalCode: null,
  prefecture: null,
  city: null,
  street: null,
  building: null,
  phone2: null,
  email2: null,
  currentEmploymentType: null,
  currentAnnualIncome: null,
  finalEducation: null,
  experienceIndustries: [],
  experienceOccupations: [],
  desiredIndustries: [],
  desiredOccupations: [],
  desiredLocations: [],
  desiredAnnualIncome: null,
  jobChangeTiming: null,
  intakeDate: null,
  firstMeetingDate: null,
  crmTags: [],
  customFields: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-06-14T00:00:00Z",
};

const emptyCtx = {
  client: baseClient,
  referrals: [] as ReferralWithJob[],
  historiesByReferral: new Map<string, ReferralStatusHistoryWithAuthor[]>(),
  interactions: [] as ClientInteractionWithAuthor[],
  placements: [] as PlacementWithAuthor[],
  tasks: [] as AgencyTaskWithAssignee[],
  disclosableProfile: null as DisclosableProfile | null,
};

describe("AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT", () => {
  it("「事実ベース」原則が含まれる(最重要)", () => {
    expect(AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT).toContain("事実ベース");
  });

  it("「内面評価・性格診断」を出さない原則が含まれる", () => {
    expect(AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT).toContain("内面評価");
  });

  it("出力 2 セクション(【状況】【次のアクション】)が指定されている", () => {
    expect(AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT).toContain("状況");
    expect(AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT).toContain("次のアクション");
  });

  it("Markdown 見出し指定が含まれる", () => {
    expect(AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT).toContain("Markdown");
  });

  it("絵文字禁止が含まれる", () => {
    expect(AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT).toContain("絵文字");
  });
});

describe("buildAgencyClientSummaryPrompt — 基本構造", () => {
  it("クライアント名・ステータス・連携状態を常に含む", () => {
    const r = buildAgencyClientSummaryPrompt(emptyCtx);
    expect(r).toContain("田中太郎");
    expect(r).toContain("現在のステータス");
    expect(r).toContain("連携状態");
  });

  it("最後に「上記データのみを根拠に」指示が出る", () => {
    const r = buildAgencyClientSummaryPrompt(emptyCtx);
    expect(r).toContain("上記データのみを根拠に");
  });
});

describe("buildAgencyClientSummaryPrompt — 内部メモ", () => {
  it("notes ありで【エージェント内部メモ】として明示される", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      client: { ...baseClient, notes: "本人非開示の内部所感" },
    });
    expect(r).toContain("エージェント内部メモ");
    expect(r).toContain("本人非開示の内部所感");
  });

  it("notes が null ならセクションが出ない", () => {
    const r = buildAgencyClientSummaryPrompt(emptyCtx);
    expect(r).not.toContain("エージェント内部メモ");
  });
});

describe("buildAgencyClientSummaryPrompt — disclosableProfile", () => {
  const profile: DisclosableProfile = {
    wants: {
      industries: ["IT", "SaaS"],
      role_types: ["バックエンド"],
      company_sizes: ["50-200"],
    },
    user_facts: {
      current_role: "エンジニア",
      years_of_experience: 5,
      industry: "IT",
    },
  };

  it("disclosableProfile=null ならセクション自体が出ない", () => {
    const r = buildAgencyClientSummaryPrompt(emptyCtx);
    expect(r).not.toContain("【本人の希望条件と現職情報");
  });

  it("disclosableProfile ありで wants と user_facts が出る", () => {
    const r = buildAgencyClientSummaryPrompt({ ...emptyCtx, disclosableProfile: profile });
    expect(r).toContain("本人の希望条件と現職情報");
    expect(r).toContain("エンジニア");
    expect(r).toContain("IT / SaaS"); // industries は ' / ' 区切り
    expect(r).toContain("バックエンド");
  });

  it("実務経験年数が null なら「実務経験年数」を含めない", () => {
    const partial: DisclosableProfile = {
      ...profile,
      user_facts: { ...profile.user_facts, years_of_experience: null },
    };
    const r = buildAgencyClientSummaryPrompt({ ...emptyCtx, disclosableProfile: partial });
    expect(r).not.toContain("実務経験年数");
  });
});

describe("buildAgencyClientSummaryPrompt — referrals", () => {
  const ref: ReferralWithJob = {
    id: "r1",
    organizationId: "o1",
    clientRecordId: "c1",
    jobPostingId: "j1",
    jobCompanyName: "ABC 社",
    jobPosition: "エンジニア",
    status: "interview",
    notes: null,
    scheduledInterviewAt: null,
    interviewNote: null,
    offerDeadlineAt: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-10T00:00:00Z",
  };

  it("空ならセクション自体が出ない", () => {
    const r = buildAgencyClientSummaryPrompt(emptyCtx);
    expect(r).not.toContain("【紹介状況");
  });

  it("ありなら【紹介状況】セクションが出る", () => {
    const r = buildAgencyClientSummaryPrompt({ ...emptyCtx, referrals: [ref] });
    expect(r).toContain("紹介状況");
    expect(r).toContain("ABC 社");
    expect(r).toContain("エンジニア");
    expect(r).toContain("面接"); // referralStatusConfig.label
  });

  it("notes ありなら「紹介メモ」が出る", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      referrals: [{ ...ref, notes: "強くプッシュ" }],
    });
    expect(r).toContain("紹介メモ");
    expect(r).toContain("強くプッシュ");
  });

  it("histories ありなら「選考の足跡」セクションが出る", () => {
    const histories: ReferralStatusHistoryWithAuthor[] = [
      {
        id: "h1",
        organizationId: "o1",
        referralId: "r1",
        fromStatus: "recommended",
        toStatus: "screening",
        changedByMemberId: null,
        changedByName: "山田",
        changedAt: "2026-06-05T10:00:00Z",
        memo: "書類通過",
        createdAt: "2026-06-05T10:00:00Z",
      },
    ];
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      referrals: [ref],
      historiesByReferral: new Map([["r1", histories]]),
    });
    expect(r).toContain("選考の足跡");
    expect(r).toContain("書類通過");
    expect(r).toContain("(山田)");
  });
});

describe("buildAgencyClientSummaryPrompt — interactions", () => {
  function interaction(
    overrides: Partial<ClientInteractionWithAuthor> = {},
  ): ClientInteractionWithAuthor {
    return {
      id: "i1",
      organizationId: "o1",
      clientRecordId: "c1",
      referralId: null,
      authorMemberId: null,
      authorName: "佐藤",
      authorAvatarUrl: null,
      interactionType: "call",
      occurredAt: "2026-06-10T10:00:00Z",
      summary: "概要文",
      body: "本文",
      createdAt: "2026-06-10T10:00:00Z",
      updatedAt: "2026-06-10T10:00:00Z",
      ...overrides,
    };
  }

  it("空ならセクションが出ない", () => {
    expect(buildAgencyClientSummaryPrompt(emptyCtx)).not.toContain("【対応履歴");
  });

  it("ありなら type ラベル(電話)と概要/詳細が出る", () => {
    const r = buildAgencyClientSummaryPrompt({ ...emptyCtx, interactions: [interaction()] });
    expect(r).toContain("対応履歴");
    expect(r).toContain("電話");
    expect(r).toContain("概要文");
    expect(r).toContain("本文");
    expect(r).toContain("(佐藤)");
  });

  it("body が 400 文字を超えると truncate(末尾が切れる)", () => {
    const long = "a".repeat(500);
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      interactions: [interaction({ body: long })],
    });
    // 全 500 文字は入らない
    expect(r).not.toContain("a".repeat(500));
    // 400 文字以下のチャンクは入る
    expect(r).toContain("a".repeat(400));
  });

  it("summary / body が null なら概要・詳細行が出ない", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      interactions: [interaction({ summary: null, body: null })],
    });
    expect(r).not.toContain("概要:");
    expect(r).not.toContain("詳細:");
  });
});

describe("buildAgencyClientSummaryPrompt — placements", () => {
  function placement(overrides: Partial<PlacementWithAuthor> = {}): PlacementWithAuthor {
    return {
      id: "p1",
      organizationId: "o1",
      referralId: "r1",
      eventType: "placement",
      amount: 500_000,
      expectedSalary: null,
      commissionRate: null,
      eventDate: "2026-06-14",
      paymentStatus: null,
      notes: null,
      reason: null,
      createdByMemberId: null,
      authorName: "佐藤",
      createdAt: "2026-06-14T00:00:00Z",
      updatedAt: "2026-06-14T00:00:00Z",
      ...overrides,
    };
  }

  it("空ならセクションが出ない", () => {
    expect(buildAgencyClientSummaryPrompt(emptyCtx)).not.toContain("【成約・入金イベント");
  });

  it("ありなら type ラベルと amount(円表記)が出る", () => {
    const r = buildAgencyClientSummaryPrompt({ ...emptyCtx, placements: [placement()] });
    expect(r).toContain("成約・入金イベント");
    expect(r).toContain("成約"); // placementEventType "placement" のラベル
    expect(r).toContain("500,000円");
  });

  it("amount が null なら「金額未入力」", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      placements: [placement({ amount: null })],
    });
    expect(r).toContain("金額未入力");
  });

  it("notes / reason ありで各セクション出る", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      placements: [placement({ notes: "ノート", reason: "理由" })],
    });
    expect(r).toContain("メモ: ノート");
    expect(r).toContain("理由: 理由");
  });
});

describe("buildAgencyClientSummaryPrompt — tasks", () => {
  function task(overrides: Partial<AgencyTaskWithAssignee> = {}): AgencyTaskWithAssignee {
    return {
      id: "t1",
      organizationId: "o1",
      clientRecordId: "c1",
      referralId: null,
      assignedMemberId: "m1",
      title: "確認連絡",
      status: "pending",
      priority: "high",
      dueAt: "2026-06-20T00:00:00Z",
      completedAt: null,
      assigneeName: "佐藤",
      assigneeAvatarUrl: null,
      createdAt: "2026-06-14T00:00:00Z",
      updatedAt: "2026-06-14T00:00:00Z",
      ...overrides,
    };
  }

  it("空ならセクションが出ない", () => {
    expect(buildAgencyClientSummaryPrompt(emptyCtx)).not.toContain("【関連タスク");
  });

  it("ありなら status マーク(○)と title・期限・担当者が出る", () => {
    const r = buildAgencyClientSummaryPrompt({ ...emptyCtx, tasks: [task()] });
    expect(r).toContain("関連タスク");
    expect(r).toContain("○ 確認連絡");
    expect(r).toContain("期限");
    expect(r).toContain("担当: 佐藤");
    expect(r).toContain("優先度: 高");
  });

  it("completed は ✓ マーク", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      tasks: [task({ status: "completed", title: "完了タスク" })],
    });
    expect(r).toContain("✓ 完了タスク");
  });

  it("priority null なら優先度行を含まない / dueAt null なら「期限なし」", () => {
    const r = buildAgencyClientSummaryPrompt({
      ...emptyCtx,
      tasks: [task({ priority: null, dueAt: null, assigneeName: null })],
    });
    expect(r).not.toContain("優先度");
    expect(r).toContain("期限なし");
    expect(r).toContain("担当未割当");
  });
});
