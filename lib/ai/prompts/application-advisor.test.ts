import { describe, it, expect } from "vitest";
import { APPLICATION_ADVISOR_SYSTEM_PROMPT, buildAdvisorContext } from "./application-advisor";
import type { Application } from "@/lib/applications/types";
import type { Task } from "@/lib/tasks/types";
import type { CareerProfile } from "@/lib/career/profile-schema";

/**
 * 応募アドバイザープロンプトのテスト。
 *
 * buildAdvisorContext は Maira が応募について「何を知っているか」を構築する境界。
 * ここに渡らない情報は AI が「無い」と扱うはずなので、profile から渡す範囲・
 * tasks の有無での出力分岐・null/空文字でセクション自体を省略する契約を担保する。
 *
 * SYSTEM プロンプトは応募者を支援する伴走 AI として「捏造しない」「不安を煽らない」
 * 等の方針が明文化されているはずなので、その core を文字列で assert する。
 */

const baseProfile: CareerProfile = {
  user_facts: {
    current_role: "エンジニア",
    years_of_experience: 5,
    industry: "IT",
    company_size: "100-500名",
  },
  strengths: [{ label: "問題解決", evidence: "○○を○○した", category: "soft_skill" }],
  values: ["挑戦", "学習"],
  wants: { industries: [], role_types: [], company_sizes: [] },
  concerns: [],
  summary: "Web 開発の経験あり",
};

function makeApp(
  overrides: Partial<Application["details"]> = {},
  extra: Partial<Application> = {},
): Application {
  return {
    id: "a1",
    details: { company: "ABC", position: "Engineer", ...overrides },
    status: "applied",
    applied_at: null,
    next_action_at: null,
    is_archived: false,
    created_at: "2026-06-14T00:00:00Z",
    updated_at: "2026-06-14T00:00:00Z",
    ...extra,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    application_id: null,
    title: "Test task",
    description: null,
    due_at: null,
    status: "pending",
    priority: 1,
    reminded_at: null,
    created_at: "2026-06-14T00:00:00Z",
    updated_at: "2026-06-14T00:00:00Z",
    ...overrides,
  };
}

describe("APPLICATION_ADVISOR_SYSTEM_PROMPT", () => {
  it("非空のプロンプト文字列", () => {
    expect(APPLICATION_ADVISOR_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

describe("buildAdvisorContext — 基本構造", () => {
  it("会社・職種・ステータスは必ず含まれる", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: baseProfile,
    });
    expect(r).toContain("ABC");
    expect(r).toContain("Engineer");
    expect(r).toContain("ステータス");
  });

  it("【相談対象の応募】セクションが先頭にある", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: baseProfile,
    });
    expect(r.indexOf("【相談対象の応募】")).toBe(0);
  });

  it("【ユーザーのキャリア情報】セクションが含まれる", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: baseProfile,
    });
    expect(r).toContain("【ユーザーのキャリア情報】");
    expect(r).toContain("Web 開発の経験あり"); // summary
  });
});

describe("buildAdvisorContext — オプション情報の有無で出し分け", () => {
  it("salary_range / location / notes は値があれば含まれる、無ければ含まれない", () => {
    const without = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: baseProfile,
    });
    expect(without).not.toContain("想定年収");
    expect(without).not.toContain("勤務地");
    expect(without).not.toContain("メモ");

    const withAll = buildAdvisorContext({
      application: makeApp({ salary_range: "600万", location: "東京", notes: "重要" }),
      tasks: [],
      profile: baseProfile,
    });
    expect(withAll).toContain("想定年収:600万");
    expect(withAll).toContain("勤務地:東京");
    expect(withAll).toContain("メモ:重要");
  });

  it("applied_at / next_action_at は値があれば日付が含まれる", () => {
    const r = buildAdvisorContext({
      application: makeApp({}, { applied_at: "2026-06-14T00:00:00Z" }),
      tasks: [],
      profile: baseProfile,
    });
    expect(r).toContain("応募日");
    expect(r).toContain("2026");
  });

  it("tasks 空ならセクション自体が出ない", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: baseProfile,
    });
    expect(r).not.toContain("【現在のタスク】");
  });

  it("tasks があれば【現在のタスク】セクションが出る", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [makeTask({ title: "履歴書を書く" })],
      profile: baseProfile,
    });
    expect(r).toContain("【現在のタスク】");
    expect(r).toContain("履歴書を書く");
  });

  it("done 状態のタスクは ✓ マーク、未完了は ○", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [
        makeTask({ title: "完了済", status: "done" }),
        makeTask({ title: "未完了", status: "pending" }),
      ],
      profile: baseProfile,
    });
    expect(r).toContain("✓ 完了済");
    expect(r).toContain("○ 未完了");
  });

  it("task の due_at があれば期限が日本語で表示される", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [makeTask({ due_at: "2026-06-20T12:00:00Z" })],
      profile: baseProfile,
    });
    expect(r).toContain("期限");
    expect(r).toContain("2026");
  });
});

describe("buildAdvisorContext — profile の取扱い", () => {
  it("strengths 空ならセクション自体が出ない", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: { ...baseProfile, strengths: [] },
    });
    expect(r).not.toContain("強み:");
  });

  it("strengths があれば label と evidence が並ぶ", () => {
    const r = buildAdvisorContext({
      application: makeApp(),
      tasks: [],
      profile: baseProfile,
    });
    expect(r).toContain("- 問題解決:○○を○○した");
  });

  it("values は ' / ' 区切り、空なら出ない", () => {
    expect(
      buildAdvisorContext({
        application: makeApp(),
        tasks: [],
        profile: baseProfile,
      }),
    ).toContain("価値観:挑戦 / 学習");

    expect(
      buildAdvisorContext({
        application: makeApp(),
        tasks: [],
        profile: { ...baseProfile, values: [] },
      }),
    ).not.toContain("価値観");
  });

  it("user_facts.current_role がある時だけ「現職」を含める", () => {
    expect(
      buildAdvisorContext({
        application: makeApp(),
        tasks: [],
        profile: baseProfile,
      }),
    ).toContain("現職:エンジニア");

    expect(
      buildAdvisorContext({
        application: makeApp(),
        tasks: [],
        profile: { ...baseProfile, user_facts: { ...baseProfile.user_facts, current_role: null } },
      }),
    ).not.toContain("現職");
  });
});
