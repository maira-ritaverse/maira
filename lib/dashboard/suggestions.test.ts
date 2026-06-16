import { describe, it, expect } from "vitest";
import { generateSuggestions } from "./suggestions";
import type { DashboardData } from "./queries";

/**
 * ダッシュボードのサジェスト生成ロジックのテスト。
 *
 * ルールベースで生成する純粋関数なので、状態 → 提案 の写像を入力ごとに検証できる。
 * 優先度は数値が大きいほど上に並ぶ。各サジェストの id・priority の重複が無い設計を
 * 担保するとともに、「条件が成立しない時は出ない」「並び順が priority desc」を確認。
 */

const emptyData: DashboardData = {
  profile: { displayName: "Test", email: null },
  career: {
    hasProfile: false,
    profileData: null,
    profileUpdatedAt: null,
    profileVersion: null,
    conversationCount: 0,
  },
  documents: { count: 0, recent: [] },
  applications: {
    total: 0,
    statusCounts: {
      considering: 0,
      applied: 0,
      document_review: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      declined: 0,
      withdrawn: 0,
    },
    recent: [],
    inProgress: [],
  },
  tasks: { total: 0, overdue: [], dueToday: [], dueThisWeek: [], upcoming: [] },
  jobRecommendations: { hasFreshSignal: false, hasLinkedAgencyJobs: false },
  aiUsageSummary: {
    photo: { current: 0, limit: 5 },
    recommendation: { current: 0, limit: 20 },
    intake: { current: 0, limit: 3 },
    hasWarning: false,
  },
  unreadNotificationCount: 0,
  upcomingMeetings: [],
  pendingInterviewShares: [],
  status: "empty",
};

// 最小限のタスクフィクスチャ(Task 型の必須フィールドだけ埋める)
function task(id: string): DashboardData["tasks"]["overdue"][number] {
  return {
    id,
    application_id: null,
    title: "Task",
    description: null,
    due_at: null,
    status: "pending",
    priority: 1,
    reminded_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// 最小限の Application フィクスチャ
function app(
  id: string,
  status: DashboardData["applications"]["recent"][number]["status"],
  appliedAt: string | null = null,
): DashboardData["applications"]["recent"][number] {
  return {
    id,
    details: { company: "X", position: "Y" },
    status,
    applied_at: appliedAt,
    next_action_at: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("generateSuggestions — 何もない状態", () => {
  it("空のデータからは何も出ない", () => {
    expect(generateSuggestions(emptyData)).toEqual([]);
  });
});

describe("generateSuggestions — 緊急(priority 100+)", () => {
  it("期限超過タスクがあれば overdue-tasks(priority 110)が先頭に", () => {
    const data = { ...emptyData, tasks: { ...emptyData.tasks, overdue: [task("t1")] } };
    const s = generateSuggestions(data);
    expect(s[0].id).toBe("overdue-tasks");
    expect(s[0].priority).toBe(110);
    expect(s[0].title).toContain("1件");
  });

  it("内定 + 期限超過 が両方あれば overdue → offer の順(110 > 105)", () => {
    const data = {
      ...emptyData,
      tasks: { ...emptyData.tasks, overdue: [task("t1")] },
      applications: { ...emptyData.applications, recent: [app("a1", "offer")] },
    };
    const ids = generateSuggestions(data).map((s) => s.id);
    expect(ids[0]).toBe("overdue-tasks");
    expect(ids[1]).toBe("offer-apps");
  });

  it("本日中のタスクは due-today(priority 100)", () => {
    const data = { ...emptyData, tasks: { ...emptyData.tasks, dueToday: [task("t1")] } };
    const s = generateSuggestions(data);
    expect(s[0].id).toBe("due-today");
    expect(s[0].priority).toBe(100);
  });
});

describe("generateSuggestions — 進捗促進(50-99)", () => {
  it("面接中の応募で interview-prep が出る", () => {
    const data = {
      ...emptyData,
      applications: { ...emptyData.applications, recent: [app("a1", "interview")] },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "interview-prep")).toBeDefined();
  });

  it("棚卸し済み + 応募 0 で first-application(priority 50)", () => {
    const data = { ...emptyData, career: { ...emptyData.career, hasProfile: true } };
    const s = generateSuggestions(data);
    const item = s.find((x) => x.id === "first-application");
    expect(item).toBeDefined();
    expect(item?.priority).toBe(50);
  });

  it("棚卸し未済では first-application は出ない", () => {
    const data = {
      ...emptyData,
      career: { ...emptyData.career, hasProfile: false },
      applications: { ...emptyData.applications, total: 0 },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "first-application")).toBeUndefined();
  });
});

describe("generateSuggestions — 経過日数チェック", () => {
  it("applied から 3 日以上経過した応募で stalled-apps が出る", () => {
    // 過去日(数年前)を使って Date.now() に依存せず確実に経過判定を通す
    const data = {
      ...emptyData,
      applications: {
        ...emptyData.applications,
        recent: [app("a1", "applied", "2020-01-01T00:00:00Z")],
      },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "stalled-apps")).toBeDefined();
  });

  it("applied_at が null の応募は stalled-apps を出さない", () => {
    const data = {
      ...emptyData,
      applications: {
        ...emptyData.applications,
        recent: [app("a1", "applied", null)],
      },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "stalled-apps")).toBeUndefined();
  });
});

describe("generateSuggestions — 進捗促進(細部)", () => {
  it("棚卸し済み + 応募あり + 書類 0 で first-document", () => {
    const data = {
      ...emptyData,
      career: { ...emptyData.career, hasProfile: true },
      applications: { ...emptyData.applications, total: 3 },
      documents: { count: 0, recent: [] },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "first-document")).toBeDefined();
  });

  it("応募が 1 件 + 棚卸し済み で more-applications", () => {
    const data = {
      ...emptyData,
      career: { ...emptyData.career, hasProfile: true },
      applications: { ...emptyData.applications, total: 1 },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "more-applications")).toBeDefined();
  });

  it("応募 2 件以上では more-applications は出ない", () => {
    const data = {
      ...emptyData,
      career: { ...emptyData.career, hasProfile: true },
      applications: { ...emptyData.applications, total: 2 },
    };
    const s = generateSuggestions(data);
    expect(s.find((x) => x.id === "more-applications")).toBeUndefined();
  });
});

describe("generateSuggestions — 並び順と一意性", () => {
  it("結果は priority 降順に並ぶ", () => {
    const data = {
      ...emptyData,
      career: { ...emptyData.career, hasProfile: true },
      tasks: { ...emptyData.tasks, overdue: [task("t1")], dueToday: [task("t2")] },
      applications: { ...emptyData.applications, recent: [app("a1", "interview")] },
    };
    const s = generateSuggestions(data);
    const priorities = s.map((x) => x.priority);
    const sorted = [...priorities].sort((a, b) => b - a);
    expect(priorities).toEqual(sorted);
  });

  it("各 id は最大 1 つしか出ない(各 if が独立かつ排他的)", () => {
    // 全条件を立てて、id の重複が無いことを確認
    const data: DashboardData = {
      ...emptyData,
      career: { ...emptyData.career, hasProfile: true },
      documents: { count: 0, recent: [] },
      applications: {
        ...emptyData.applications,
        total: 1,
        recent: [
          app("a1", "offer"),
          app("a2", "interview"),
          app("a3", "applied", "2020-01-01T00:00:00Z"),
        ],
      },
      tasks: {
        ...emptyData.tasks,
        overdue: [task("t1")],
        dueToday: [task("t2")],
        dueThisWeek: [task("t3")],
      },
    };
    const s = generateSuggestions(data);
    const ids = s.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
