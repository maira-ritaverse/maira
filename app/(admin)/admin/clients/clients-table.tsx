"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Input } from "@/components/ui/input";
import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { clientStatusLabels } from "@/lib/clients/types";

type ClientRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationIsPersonal: boolean;
  name: string;
  nameKana: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  linkStatus: string;
  entrySite: string | null;
  gender: string | null;
  prefecture: string | null;
  currentEmploymentType: string | null;
  currentAnnualIncome: number | null;
  crmTags: string[];
  intakeDate: string | null;
  createdAt: string;
  updatedAt: string;
  assignedMemberEmail: string | null;
  createdByEmail: string | null;
};

type OrgRow = {
  id: string;
  name: string;
  archivedAt: string | null;
};

type ListResponse = {
  clients: ClientRow[];
  total: number;
  limit: number;
  truncated: boolean;
};

type OrgListResponse = {
  organizations: OrgRow[];
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全ステータス" },
  ...Object.entries(clientStatusLabels).map(([value, label]) => ({ value, label })),
];

/**
 * 全企業の求職者 CRM 一覧 (client_records) を admin から閲覧するテーブル。
 *
 * フィルタ: 企業 / ステータス / 名前 (name / kana / email 部分一致、 300ms debounce)
 */
export function ClientsTable() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("admin-clients-q", "");
  const [orgFilter, setOrgFilter] = usePersistedState("admin-clients-org", "");
  const [statusFilter, setStatusFilter] = usePersistedState("admin-clients-status", "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchClients = async (q: string, org: string, status: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (org) params.set("organizationId", org);
      if (status) params.set("status", status);
      const qs = params.toString();
      const res = await apiFetch<ListResponse>(`/api/admin/clients${qs ? `?${qs}` : ""}`);
      setClients(res?.clients ?? []);
      setTruncated(Boolean(res?.truncated));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // 組織 一覧 は 初回 のみ 取得 (dropdown に 使う。 変化 頻度 低い)
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<OrgListResponse>("/api/admin/organizations");
        setOrgs(res?.organizations ?? []);
      } catch {
        // dropdown が 出な くて も 一覧 は 引ける ので エラー は 握る
      }
    })();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchClients(query, orgFilter, statusFilter);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
     
  }, [query, orgFilter, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="border-input bg-background max-w-xs rounded-md border px-3 py-2 text-sm"
          aria-label="企業で絞り込み"
        >
          <option value="">全企業</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.archivedAt ? "(停止中)" : ""}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          aria-label="ステータスで絞り込み"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前 / カナ / メール…"
          className="max-w-xs"
        />
        <p className="text-muted-foreground text-xs">{clients.length} 件</p>
        <RefreshButton
          onClick={() => void fetchClients(query, orgFilter, statusFilter)}
          loading={loading}
        />
      </div>

      {truncated && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          結果が 500 件を超えたため一部のみ表示しています。企業 / ステータスで絞り込んでください。
        </p>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : clients.length === 0 ? (
        <p className="text-muted-foreground text-sm">該当する求職者がいません。</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
              <tr>
                <th className="px-3 py-2.5">企業</th>
                <th className="px-3 py-2.5">氏名 / カナ</th>
                <th className="px-3 py-2.5">連絡先</th>
                <th className="px-3 py-2.5">ステータス</th>
                <th className="px-3 py-2.5">連携</th>
                <th className="px-3 py-2.5">担当CA</th>
                <th className="px-3 py-2.5">登録日</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-accent/40 odd:bg-muted/10 border-t transition-colors"
                >
                  <td className="px-3 py-2.5 text-xs">
                    <Link
                      href={`/admin/organizations/${c.organizationId}`}
                      className="hover:underline"
                    >
                      {c.organizationName}
                    </Link>
                    {c.organizationIsPersonal && (
                      <span className="ml-1 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                        個人
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-muted-foreground text-[10px]">{c.nameKana ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <div>
                      {c.email ?? <span className="text-muted-foreground">メール未登録</span>}
                    </div>
                    <div className="text-muted-foreground text-[10px]">{c.phone ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <LinkStatusBadge status={c.linkStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {c.assignedMemberEmail ?? <span className="text-muted-foreground">未割当</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {new Date(c.createdAt).toLocaleDateString("ja-JP")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = clientStatusLabels[status as keyof typeof clientStatusLabels] ?? status;
  const tone: Record<string, string> = {
    initial_meeting: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    job_matching: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    in_screening: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-200",
    offer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    completed: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100",
    declined: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}

function LinkStatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    unlinked: "未連携",
    invited: "招待済",
    linked: "連携済",
    revoke_requested: "解除申請中",
    revoked: "解除",
  };
  const tone: Record<string, string> = {
    unlinked: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    invited: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    linked: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    revoke_requested: "bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    revoked: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {label[status] ?? status}
    </span>
  );
}
