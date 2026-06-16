"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Member = {
  id: string;
  userId: string;
  email: string | null;
  role: "admin" | "advisor";
  createdAt: string;
  clientCount: number;
  linkedClientCount: number;
  recentClientsAdded30d: number;
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

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DetailResponse>(`/api/admin/organizations/${organizationId}`);
      setData(res ?? null);
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
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
                  <tr>
                    <th className="px-3 py-2.5">role</th>
                    <th className="px-3 py-2.5">メアド</th>
                    <th className="px-3 py-2.5 text-right">担当 client</th>
                    <th className="px-3 py-2.5 text-right">うち連携済</th>
                    <th className="px-3 py-2.5 text-right">30 日新規</th>
                    <th className="px-3 py-2.5">加入日</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      className="hover:bg-accent/40 odd:bg-muted/10 border-t transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <RoleBadge role={m.role} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {m.email ?? <span className="text-muted-foreground">—</span>}
                        <div className="text-muted-foreground text-[10px]">{m.userId}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-semibold">
                        {m.clientCount}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs">{m.linkedClientCount}</td>
                      <td className="px-3 py-2.5 text-right text-xs">{m.recentClientsAdded30d}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {new Date(m.createdAt).toLocaleDateString("ja-JP")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
