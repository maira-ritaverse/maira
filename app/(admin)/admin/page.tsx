import Link from "next/link";

import { Card } from "@/components/ui/card";
import { getAdminDashboardSummary } from "@/lib/admin/dashboard-summary";
import { formatJpy } from "@/lib/features/ai-pricing";

/**
 * 運営管理ホーム(ダッシュボード)。
 *
 * 構成:
 *   1. 「今やるべきこと」 — 対応必要なものを大きめのアラートカードで
 *   2. 直近 30 日 KPI(4 カード)
 *   3. プライバシーポリシー同意分布(3 カード)
 *   4. ショートカット(機能カードのグリッド)
 *
 * 画面いっぱいに使う:max-w 無しで全幅。コンテンツが薄い場所は均等グリッドで埋める。
 */
export default async function AdminHomePage() {
  const summary = await getAdminDashboardSummary();
  const hasUrgent =
    summary.unreadContacts > 0 ||
    summary.alerts.organizationsWithoutAdmin > 0 ||
    summary.alerts.dormantOrganizations > 0 ||
    summary.aiCost.status === "warning" ||
    summary.aiCost.status === "exceeded";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">運営ダッシュボード</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Maira 運営者のホーム。対応が必要な項目を優先表示します。
        </p>
      </div>

      {/* === 今やるべきこと === */}
      {hasUrgent && (
        <section className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            今やるべきこと
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {summary.unreadContacts > 0 && (
              <UrgentCard
                href="/admin/contacts"
                tone="blue"
                title="未読の問い合わせ"
                value={String(summary.unreadContacts)}
                hint="返信が必要な案件があります"
              />
            )}
            {summary.alerts.organizationsWithoutAdmin > 0 && (
              <UrgentCard
                href="/admin/organizations"
                tone="red"
                title="admin 不在の企業"
                value={String(summary.alerts.organizationsWithoutAdmin)}
                hint="管理者を補充するか統合を検討"
              />
            )}
            {summary.alerts.dormantOrganizations > 0 && (
              <UrgentCard
                href="/admin/organizations"
                tone="amber"
                title="休眠の可能性"
                value={String(summary.alerts.dormantOrganizations)}
                hint="90 日以上メンバー追加なし"
              />
            )}
            {summary.aiCost.status === "exceeded" && (
              <UrgentCard
                href="/admin/ai-usage"
                tone="red"
                title="AI 予算超過"
                value={`${summary.aiCost.percent}%`}
                hint={`${formatJpy(summary.aiCost.thisMonthJpy)} / ${formatJpy(summary.aiCost.budgetJpy)}`}
              />
            )}
            {summary.aiCost.status === "warning" && (
              <UrgentCard
                href="/admin/ai-usage"
                tone="amber"
                title="AI 予算 80% 到達"
                value={`${summary.aiCost.percent}%`}
                hint={`${formatJpy(summary.aiCost.thisMonthJpy)} / ${formatJpy(summary.aiCost.budgetJpy)}`}
              />
            )}
          </div>
        </section>
      )}

      {/* === 直近 30 日 KPI === */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            直近 30 日
          </h2>
          <Link
            href="/admin/kpi"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            詳細 KPI →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="新規ユーザ" value={summary.recent30d.newUsers} />
          <Kpi label="新規応募" value={summary.recent30d.newApplications} />
          <Kpi label="新規企業" value={summary.recent30d.newOrganizations} />
          <Kpi
            label="AI 呼出"
            value={summary.recent30d.aiCalls}
            sub={formatJpy(summary.aiCost.thisMonthJpy)}
          />
        </div>
      </section>

      {/* === プライバシーポリシー同意分布 === */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            プライバシーポリシー同意状況
          </h2>
          <p className="text-muted-foreground text-[10px]">
            現バージョン:{summary.privacyPolicy.version}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PolicyCard
            label="同意済(最新)"
            value={summary.privacyPolicy.acceptedCurrent}
            tone="emerald"
          />
          <PolicyCard
            label="旧バージョン同意"
            value={summary.privacyPolicy.acceptedOld}
            tone="amber"
          />
          <PolicyCard label="未同意" value={summary.privacyPolicy.notAccepted} tone="muted" />
        </div>
      </section>

      {/* === ショートカット(機能) === */}
      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          管理機能
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <FeatureCard
            href="/admin/users"
            icon="👥"
            title="ユーザ管理"
            desc="検索 / 状態確認 / 強制削除(法令対応)"
          />
          <FeatureCard
            href="/admin/organizations"
            icon="🏢"
            title="エージェント企業"
            desc="一覧 / 詳細(advisor / clients / 30 日活動)"
          />
          <FeatureCard
            href="/admin/ai-usage"
            icon="⚡"
            title="AI 利用量モニタ"
            desc="月別 AI 呼出 + 推定コスト"
          />
          <FeatureCard
            href="/admin/kpi"
            icon="📊"
            title="KPI ダッシュボード"
            desc="累計指標 + 直近 30 日"
          />
          <FeatureCard
            href="/admin/audit-logs"
            icon="📜"
            title="監査ログ"
            desc="重要操作の履歴 + CSV エクスポート"
          />
          <FeatureCard
            href="/admin/contacts"
            icon="📨"
            title="問い合わせ受信箱"
            desc={
              summary.unreadContacts > 0
                ? `未読 ${summary.unreadContacts} 件`
                : "履歴 + 既読 / メモ管理"
            }
            badge={summary.unreadContacts}
          />
          <FeatureCard
            href="/admin/announcements"
            icon="📣"
            title="お知らせ管理"
            desc="エージェント企業向け通知"
          />
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// 内部コンポーネント
// ============================================================================

function UrgentCard({
  href,
  tone,
  title,
  value,
  hint,
}: {
  href: string;
  tone: "red" | "amber" | "blue";
  title: string;
  value: string;
  hint?: string;
}) {
  const cls = {
    red: "border-red-300 bg-red-50 hover:border-red-400 dark:border-red-900 dark:bg-red-950/30 dark:hover:border-red-800",
    amber:
      "border-amber-300 bg-amber-50 hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:border-amber-800",
    blue: "border-blue-300 bg-blue-50 hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950/30 dark:hover:border-blue-800",
  }[tone];
  return (
    <Link href={href} className={`block rounded-lg border p-4 transition-colors ${cls}`}>
      <p className="text-xs font-medium">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-[11px]">{hint}</p>}
    </Link>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString()}</p>
      {sub && <p className="text-muted-foreground mt-0.5 text-[11px]">{sub}</p>}
    </Card>
  );
}

function PolicyCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "muted";
}) {
  const cls = {
    emerald: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
    amber: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    muted: "border-border bg-muted/20",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}

function FeatureCard({
  href,
  icon,
  title,
  desc,
  badge,
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="hover:border-foreground/40 group bg-card flex items-start gap-3 rounded-lg border p-4 transition-colors"
    >
      <span className="text-2xl">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {title}
          {badge !== undefined && badge > 0 && (
            <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
              {badge}
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-sm">{desc}</p>
      </div>
      <span className="text-muted-foreground group-hover:text-foreground transition-colors">→</span>
    </Link>
  );
}
