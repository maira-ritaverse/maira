import { createClient } from "@/lib/supabase/server";
import { getCareerProfile, listCareerConversations } from "@/lib/career/conversations";
import { listDocumentConversations } from "@/lib/documents/conversations";
import { listApplications } from "@/lib/applications/queries";
import { listAllTasks } from "@/lib/tasks/queries";
import type { CareerProfile } from "@/lib/career/profile-schema";
import type { Application, ApplicationStatus } from "@/lib/applications/types";
import type { Task } from "@/lib/tasks/types";

/**
 * ダッシュボード用のデータ集約レイヤー
 *
 * 各機能モジュール(career / documents / applications / tasks)の
 * ヘルパー関数を Promise.all で並行取得し、ダッシュボード表示に必要な
 * 情報をまとめた形で返す。
 *
 * Server Component から呼び出される前提。
 */

/**
 * ユーザーの利用状況を 3 段階で分類する。
 * Phase 1 では「どのダッシュボード状態を出すか」の単純な分岐に使う。
 *
 * - empty:   キャリア棚卸し未実施。オンボーディング誘導が中心。
 * - starter: 棚卸し済みだが進行中の応募が少ない。次のアクション提案中心。
 * - active:  進行中の応募が複数あり、横断的な状況把握が必要なフェーズ。
 */
export type UserStatus = "empty" | "starter" | "active";

/**
 * ダッシュボード表示に必要な、全モジュール横断のデータ。
 *
 * Phase 2 でサジェスト機能や横断タスクビューを足すときも、
 * この型に必要なフィールドを追加する形にする。
 */
export type DashboardData = {
  profile: {
    displayName: string;
    email: string | null;
  };
  career: {
    hasProfile: boolean;
    profileData: CareerProfile | null;
    profileUpdatedAt: string | null;
    profileVersion: number | null;
    conversationCount: number;
  };
  documents: {
    count: number;
    recent: Array<{
      id: string;
      type: string | null;
      jobPreview: string | null;
      createdAt: string;
    }>;
  };
  applications: {
    total: number;
    statusCounts: Record<ApplicationStatus, number>;
    recent: Application[];
    inProgress: Application[];
  };
  tasks: {
    total: number;
    overdue: Task[];
    dueToday: Task[];
    dueThisWeek: Task[];
    upcoming: Task[];
  };
  status: UserStatus;
};

/**
 * ダッシュボード用の全データを並行取得する。
 *
 * Promise.all で各機能のクエリを同時実行し、初回ロードのレイテンシを抑える。
 * 個別の関数はそれぞれ内部で createClient() を作るため、Supabase の HTTP 接続は
 * リクエスト分(ここでは 7 並列)走るが、サーバーレス環境では問題にならない範囲。
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = await createClient();

  // 7 つのクエリを並行に投げ、いずれかが失敗すれば throw する。
  // ダッシュボードはどれか 1 つ欠けても全体が成立しないため fail-fast でよい。
  const [
    { data: profileRow },
    {
      data: { user },
    },
    careerProfile,
    careerConversations,
    documentConversations,
    applications,
    allTasks,
  ] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.auth.getUser(),
    getCareerProfile(userId),
    listCareerConversations(userId),
    listDocumentConversations(userId),
    listApplications(userId),
    listAllTasks(userId),
  ]);

  // 応募のステータス別カウント。
  // enum の全キーをゼロで初期化してから集計し、UI 側で `?? 0` を書かなくて済むようにする。
  const statusCounts: Record<ApplicationStatus, number> = {
    considering: 0,
    applied: 0,
    document_review: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    declined: 0,
    withdrawn: 0,
  };
  for (const app of applications) {
    statusCounts[app.status]++;
  }

  // 「進行中」とみなすステータス。
  // rejected / declined / withdrawn は終了済みなので除外する。
  const inProgressStatuses: ApplicationStatus[] = [
    "considering",
    "applied",
    "document_review",
    "interview",
    "offer",
  ];
  const inProgress = applications.filter((a) => inProgressStatuses.includes(a.status));

  // タスクを期限別に分類する。
  // - overdue:     期限切れ
  // - dueToday:    今日中
  // - dueThisWeek: 今日以降〜7日後まで
  // - upcoming:    それ以降、または期限なし
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const dueThisWeek: Task[] = [];
  const upcoming: Task[] = [];

  for (const task of allTasks) {
    if (!task.due_at) {
      upcoming.push(task);
      continue;
    }
    const due = new Date(task.due_at);
    if (due < now) {
      overdue.push(task);
    } else if (due <= todayEnd) {
      dueToday.push(task);
    } else if (due <= weekEnd) {
      dueThisWeek.push(task);
    } else {
      upcoming.push(task);
    }
  }

  // 書類会話の直近 3 件分の表示用データ。
  // metadata は createDocumentConversation 側で document_type / job_info_preview を入れている。
  // 構造が想定通りでない古いデータが来ても落ちないよう、any 型にせず型で防御する。
  const recentDocuments = documentConversations.slice(0, 3).map((doc) => {
    const metadata = (doc.metadata ?? {}) as {
      document_type?: string;
      job_info_preview?: string;
    };
    return {
      id: doc.id,
      type: metadata.document_type ?? null,
      jobPreview: metadata.job_info_preview ?? null,
      createdAt: doc.created_at,
    };
  });

  // ユーザー状態の判定。
  // - 棚卸しなし → empty
  // - 棚卸しあり + 進行中の応募 3 件未満 → starter
  // - 棚卸しあり + 進行中の応募 3 件以上 → active
  let status: UserStatus = "empty";
  if (careerProfile !== null) {
    status = "starter";
    if (inProgress.length >= 3) {
      status = "active";
    }
  }

  return {
    profile: {
      displayName: profileRow?.display_name ?? "あなた",
      email: user?.email ?? null,
    },
    career: {
      hasProfile: careerProfile !== null,
      profileData: careerProfile?.profile ?? null,
      profileUpdatedAt: careerProfile?.updatedAt ?? null,
      profileVersion: careerProfile?.version ?? null,
      conversationCount: careerConversations.length,
    },
    documents: {
      count: documentConversations.length,
      recent: recentDocuments,
    },
    applications: {
      total: applications.length,
      statusCounts,
      recent: applications.slice(0, 5),
      inProgress,
    },
    tasks: {
      total: allTasks.length,
      overdue,
      dueToday,
      dueThisWeek,
      upcoming,
    },
    status,
  };
}
