import type { DashboardData } from "./queries";

/**
 * ダッシュボードに表示する「次にやること」サジェスト。
 *
 * ルールベースで生成する(AI 呼び出しなし)。即時生成・低コスト・決定的なため、
 * ユーザーの状態が同じなら毎回同じ提案が出る。これは初期実装として意図的な選択。
 *
 * 将来 AI で動的生成に置き換える場合も、Suggestion 型はそのまま使う想定。
 */
export type Suggestion = {
  id: string;
  /** 数値が大きいほど上に出る。同種は 1 つだけ生成するので重複の心配なし */
  priority: number;
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
  variant: "primary" | "warning" | "info";
};

/**
 * ダッシュボードデータから「次にやること」を生成する。
 *
 * 優先度の高い順に並ぶ。表示側で上位数件に絞る前提。
 *
 * 設計方針:
 * - 状態が悪い(期限超過等)ほど優先度を高く
 * - ユーザーがすぐ行動できる具体的なアクションを提案
 * - 同じ id のサジェストは複数生成しない(各 if は独立かつ排他的)
 */
export function generateSuggestions(data: DashboardData): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // ===== 優先度 100 以上:緊急 =====

  if (data.tasks.overdue.length > 0) {
    suggestions.push({
      id: "overdue-tasks",
      priority: 110,
      icon: "⚠️",
      title: `${data.tasks.overdue.length}件のタスクが期限超過`,
      description: "応募の進行に影響するかもしれません。確認しましょう。",
      actionLabel: "タスクを確認",
      actionHref: "/app/tasks",
      variant: "warning",
    });
  }

  // 内定がある場合は条件確認・回答期限が絡むため緊急扱い。
  // recent(最新 5 件)を見ているのは、古すぎる内定通知をサジェストから外すため。
  const offerApps = data.applications.recent.filter((a) => a.status === "offer");
  if (offerApps.length > 0) {
    suggestions.push({
      id: "offer-apps",
      priority: 105,
      icon: "🎉",
      title: `${offerApps.length}件の内定があります`,
      description: "条件確認や次のステップをMairaに相談できます。",
      actionLabel: "応募を確認",
      actionHref: `/app/applications/${offerApps[0].id}`,
      variant: "primary",
    });
  }

  if (data.tasks.dueToday.length > 0) {
    suggestions.push({
      id: "due-today",
      priority: 100,
      icon: "📅",
      title: `本日中のタスクが${data.tasks.dueToday.length}件`,
      description: "今日中に対応する必要のあるタスクがあります。",
      actionLabel: "タスクを確認",
      actionHref: "/app/tasks",
      variant: "warning",
    });
  }

  // ===== 優先度 50-99:進捗促進 =====

  const interviewApps = data.applications.recent.filter((a) => a.status === "interview");
  if (interviewApps.length > 0) {
    suggestions.push({
      id: "interview-prep",
      priority: 80,
      icon: "🎤",
      title: `${interviewApps.length}件の応募が面接中`,
      description: "Mairaに面接対策を相談できます。",
      actionLabel: "応募を確認",
      actionHref: `/app/applications/${interviewApps[0].id}`,
      variant: "primary",
    });
  }

  // 棚卸し済みだが応募ゼロ。初動を促す。
  // first-application は応募追加の最重要 CTA なので優先度を高めに設定。
  if (data.career.hasProfile && data.applications.total === 0) {
    suggestions.push({
      id: "first-application",
      priority: 50,
      icon: "🚀",
      title: "最初の応募を登録しましょう",
      description: "気になる求人があれば、応募管理に追加してMairaに相談できます。",
      actionLabel: "応募を追加",
      actionHref: "/app/applications/new",
      variant: "primary",
    });
  }

  // 今週中のタスク。本日中は別カードで出すので、ここでは「先を見据えた計画」として info 扱い。
  if (data.tasks.dueThisWeek.length > 0) {
    suggestions.push({
      id: "due-this-week",
      priority: 60,
      icon: "📌",
      title: `今週中のタスクが${data.tasks.dueThisWeek.length}件`,
      description: "余裕を持って対応できるよう、計画を立てましょう。",
      actionLabel: "タスクを確認",
      actionHref: "/app/tasks",
      variant: "info",
    });
  }

  // ===== 優先度 1-49:アクション促進 =====

  // 応募が applied 状態のまま 3 日以上経過しているもの。
  // 「3 日」は経験則(書類選考の音沙汰なし期間として一般的)。
  const stalledApps = data.applications.recent.filter((a) => {
    if (a.status !== "applied" || !a.applied_at) return false;
    const days = (Date.now() - new Date(a.applied_at).getTime()) / (1000 * 60 * 60 * 24);
    return days >= 3;
  });
  if (stalledApps.length > 0) {
    suggestions.push({
      id: "stalled-apps",
      priority: 40,
      icon: "🔍",
      title: `${stalledApps.length}件の応募の進捗確認時期`,
      description: "応募から数日経過しています。進捗を確認してみましょう。",
      actionLabel: "応募を確認",
      actionHref: `/app/applications/${stalledApps[0].id}`,
      variant: "info",
    });
  }

  // 棚卸し済み + 応募あり + 書類未作成。書類作成モジュールへの導線として。
  if (data.career.hasProfile && data.applications.total > 0 && data.documents.count === 0) {
    suggestions.push({
      id: "first-document",
      priority: 35,
      icon: "📝",
      title: "応募書類を作成しましょう",
      description: "あなたのキャリア情報から、職務経歴書や志望動機を生成できます。",
      actionLabel: "書類を作成",
      actionHref: "/app/documents/new",
      variant: "info",
    });
  }

  // 応募が 1 件しかない。選択肢を広げる提案。
  if (data.applications.total === 1 && data.career.hasProfile) {
    suggestions.push({
      id: "more-applications",
      priority: 30,
      icon: "📋",
      title: "他の応募先も検討してみましょう",
      description: "複数の応募を並行して進めることで、選択肢が広がります。",
      actionLabel: "応募を追加",
      actionHref: "/app/applications/new",
      variant: "info",
    });
  }

  suggestions.sort((a, b) => b.priority - a.priority);

  return suggestions;
}
