"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { formatJpy } from "@/lib/features/ai-pricing";

type Member = {
  id: string;
  userId: string;
  email: string | null;
  role: "admin" | "advisor";
  createdAt: string;
  clientCount: number;
  linkedClientCount: number;
  recentClientsAdded30d: number;
  // 稼働 状況 (直近 30 日)
  lastSignInAt: string | null;
  activity30d: {
    clients: number;
    jobs: number;
    referrals: number;
    tasks: number;
  };
  aiUsage30d: {
    total: number;
    byKind: Record<string, number>;
    estimatedCostJpy: number;
  };
};

type DetailResponse = {
  organization: { id: string; name: string; createdAt: string };
  summary: {
    adminCount: number;
    advisorCount: number;
    memberCount: number;
    clientCount: number;
    linkedClientCount: number;
    jobCount: number;
  };
  recent30d: {
    clientsAdded: number;
    jobsAdded: number;
    referralsCreated: number;
  };
  members: Member[];
  unassigned: { clientCount: number; linkedClientCount: number };
};

type Props = {
  organizationId: string;
};

type TabKey = "overview" | "members" | "alerts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "概要" },
  { key: "members", label: "メンバー" },
  { key: "alerts", label: "注意点" },
];

/**
 * 企業詳細ビュー(タブ UI 化)。
 *
 * タブ構成:
 *   - 概要:統計サマリ + 直近 30 日アクティビティ
 *   - メンバー:全メンバーの一覧 + 担当数 + 30 日新規
 *   - 注意点:未アサインクライアント / その他将来のアラート
 *
 * 上部にヘッダ(企業名 + 作成日 + リフレッシュ)、その下にタブナビ、その下に内容。
 * タブ切替は localStorage に永続化しない(画面遷移後は概要に戻す方が直感的)。
 */
export function OrganizationDetail({ organizationId }: Props) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  // fetch 完了時 の Date.now() を state に置くこと で、 レンダー中の
  // Date.now() 呼び出し (react-hooks/purity 違反) を回避 しつつ、
  // 再フェッチ時 に 「◯日前」 の表示 が最新化 されるように する。
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DetailResponse>(`/api/admin/organizations/${organizationId}`);
      setData(res ?? null);
      setNowMs(Date.now());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void fetchDetail();
  }, [fetchDetail]);

  if (loading && !data) return <p className="text-muted-foreground text-sm">読み込み中…</p>;
  if (error) return <p className="text-destructive text-xs">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">データなし。</p>;

  const { organization: org, summary, recent30d, members, unassigned } = data;
  const hasAlerts =
    unassigned.clientCount > 0 || summary.adminCount === 0 || summary.memberCount === 0;

  return (
    <div className="space-y-6">
      {/* === ヘッダ === */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold">{org.name}</h1>
          <p className="text-muted-foreground text-[10px]">
            {org.id} / 作成日 {new Date(org.createdAt).toLocaleDateString("ja-JP")}
          </p>
        </div>
        <RefreshButton onClick={() => void fetchDetail()} loading={loading} />
      </div>

      {/* === タブナビ === */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => {
          const active = tab === t.key;
          const badge = t.key === "alerts" && hasAlerts ? "!" : null;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "text-foreground border-foreground -mb-px border-b-2"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {badge && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* === 概要タブ === */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">
              統計
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="管理者" value={summary.adminCount} />
              <StatCard label="アドバイザー" value={summary.advisorCount} />
              <StatCard label="メンバー合計" value={summary.memberCount} />
              <StatCard label="クライアント" value={summary.clientCount} />
              <StatCard
                label="うち連携済"
                value={summary.linkedClientCount}
                sub={
                  summary.clientCount > 0
                    ? `${Math.round((summary.linkedClientCount / summary.clientCount) * 100)}%`
                    : undefined
                }
              />
              <StatCard label="求人" value={summary.jobCount} />
            </div>
          </div>

          <div>
            <h2 className="text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">
              直近 30 日のアクティビティ
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="新規クライアント" value={recent30d.clientsAdded} />
              <StatCard label="新規求人" value={recent30d.jobsAdded} />
              <StatCard label="新規紹介" value={recent30d.referralsCreated} />
            </div>
          </div>
        </div>
      )}

      {/* === メンバータブ === */}
      {tab === "members" && (
        <div className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            メンバー一覧({members.length})
          </h2>
          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              メンバーが登録されていません(admin 不在の組織)。
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-[11px]">
                稼働数は 2026-07-19 以降の起票分のみを集計します(actor 追跡カラム追加のため)。 LINE
                / メール送信数は per-user の送信元が未追跡のため出せません(組織合計は概要タブ参照)。
              </p>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
                    <tr>
                      <th className="px-3 py-2.5">role</th>
                      <th className="px-3 py-2.5">メアド</th>
                      <th className="px-3 py-2.5 text-right">担当 client</th>
                      <th className="px-3 py-2.5 text-right">うち連携済</th>
                      <th className="px-3 py-2.5">最終ログイン</th>
                      <th className="px-3 py-2.5">加入日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <MemberRow key={m.id} member={m} nowMs={nowMs} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* === 注意点タブ === */}
      {tab === "alerts" && (
        <div className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            運営対応が必要な項目
          </h2>
          {!hasAlerts && <p className="text-muted-foreground text-sm">特に注意点はありません。</p>}
          {summary.adminCount === 0 && (
            <AlertBox
              tone="red"
              title="admin が不在"
              body="このエージェント企業には admin ロールのメンバーが居ません。管理者を補充するか、組織の統合を検討してください。"
            />
          )}
          {summary.memberCount === 0 && (
            <AlertBox
              tone="amber"
              title="メンバー 0 人"
              body="まだ誰も招待されていません。新規発行直後 / 利用開始されていない可能性があります。"
            />
          )}
          {unassigned.clientCount > 0 && (
            <AlertBox
              tone="amber"
              title={`未アサインのクライアント ${unassigned.clientCount} 件(うち連携済 ${unassigned.linkedClientCount} 件)`}
              body="担当 advisor が外れた / 削除されたなどで宙に浮いているクライアントがあります。社内で再アサインを依頼してください。"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 内部コンポーネント
// ============================================================================

function MemberRow({ member: m, nowMs }: { member: Member; nowMs: number }) {
  const activitySum =
    m.activity30d.clients + m.activity30d.jobs + m.activity30d.referrals + m.activity30d.tasks;
  const isDormant = activitySum === 0 && m.aiUsage30d.total === 0;
  return (
    <>
      <tr className="hover:bg-accent/40 odd:bg-muted/10 border-t transition-colors">
        <td className="px-3 py-2.5">
          <RoleBadge role={m.role} />
        </td>
        <td className="px-3 py-2.5 text-xs">
          {m.email ?? <span className="text-muted-foreground">—</span>}
          <div className="text-muted-foreground text-[10px]">{m.userId}</div>
        </td>
        <td className="px-3 py-2.5 text-right text-xs font-semibold">{m.clientCount}</td>
        <td className="px-3 py-2.5 text-right text-xs">{m.linkedClientCount}</td>
        <td className="px-3 py-2.5 text-xs">
          <LastSignInCell iso={m.lastSignInAt} nowMs={nowMs} />
        </td>
        <td className="px-3 py-2.5 text-xs">{new Date(m.createdAt).toLocaleDateString("ja-JP")}</td>
      </tr>
      {/* サブ 行: 直近 30 日 の 稼働 状況 (業務 起票 + AI 使用) */}
      <tr className="odd:bg-muted/10">
        <td colSpan={6} className="text-muted-foreground border-t px-3 pt-1 pb-2.5 text-[11px]">
          {isDormant ? (
            <span className="text-amber-700 dark:text-amber-500">
              30日間の稼働なし(起票 / AI 使用ともに 0)
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">30日稼働:</span>
              <MetricChip label="求職者" value={m.activity30d.clients} />
              <MetricChip label="求人" value={m.activity30d.jobs} />
              <MetricChip label="応募" value={m.activity30d.referrals} />
              <MetricChip label="タスク" value={m.activity30d.tasks} />
              <span className="text-muted-foreground/60">|</span>
              <MetricChip label="AI" value={m.aiUsage30d.total} />
              {m.aiUsage30d.estimatedCostJpy > 0 && (
                <span className="text-muted-foreground">
                  (推定 {formatJpy(m.aiUsage30d.estimatedCostJpy)})
                </span>
              )}
            </div>
          )}
        </td>
      </tr>
    </>
  );
}

function LastSignInCell({ iso, nowMs }: { iso: string | null; nowMs: number }) {
  if (!iso) return <span className="text-muted-foreground">未ログイン</span>;
  const d = new Date(iso);
  const diffMs = nowMs - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const label =
    diffDays < 1
      ? "本日"
      : diffDays < 7
        ? `${diffDays}日前`
        : diffDays < 30
          ? `${Math.floor(diffDays / 7)}週前`
          : `${Math.floor(diffDays / 30)}ヶ月前`;
  const tone =
    diffDays < 7
      ? "text-emerald-700 dark:text-emerald-400"
      : diffDays < 30
        ? "text-slate-700 dark:text-slate-300"
        : "text-amber-700 dark:text-amber-500";
  return (
    <span className={tone}>
      {label}
      <span className="text-muted-foreground ml-1 text-[10px]">
        ({d.toLocaleDateString("ja-JP")})
      </span>
    </span>
  );
}

function MetricChip({ label, value }: { label: string; value: number }) {
  const isZero = value === 0;
  return (
    <span className={isZero ? "text-muted-foreground/60" : "text-slate-700 dark:text-slate-300"}>
      {label}
      <span
        className={`ml-0.5 font-semibold ${isZero ? "" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {value}
      </span>
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: "admin" | "advisor" }) {
  const cls =
    role === "admin"
      ? "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200"
      : "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{role}</span>;
}

function AlertBox({ tone, title, body }: { tone: "red" | "amber"; title: string; body: string }) {
  const cls = {
    red: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
    amber:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs">{body}</p>
    </div>
  );
}
