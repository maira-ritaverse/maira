"use client";

import { useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Input } from "@/components/ui/input";
import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type SeekerRow = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  onboardedAt: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  resumeCount: number;
  applicationCount: number;
  conversationCount: number;
  linkedAgencyCount: number;
};

type ListResponse = {
  seekers: SeekerRow[];
  total: number;
};

/**
 * 運営者用の求職者一覧テーブル (現役 / 停止中を archived プロップで切替)。
 *
 * ・検索: メアド部分一致 (300ms debounce、IME 入力連打対策)
 * ・アーカイブ操作は /admin/users から行う (この画面は 「一覧 と 稼働 状況」 特化)
 * ・稼働 レベル は 「履歴書 + 応募 + 会話 の 合計 が 0」 かつ 「連携 CA 0」 で
 *   dormant 判定。 amber ハイライト。
 */
export function SeekersTable({ archived }: { archived: boolean }) {
  const [seekers, setSeekers] = useState<SeekerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = usePersistedState("admin-seekers-q", "");
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSeekers = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (archived) params.set("archived", "true");
      const qs = params.toString();
      const res = await apiFetch<ListResponse>(`/api/admin/seekers${qs ? `?${qs}` : ""}`);
      setSeekers(res?.seekers ?? []);
      setNowMs(Date.now());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSeekers(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, archived]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メールアドレスで検索…"
          className="max-w-sm"
        />
        <p className="text-muted-foreground text-xs">{seekers.length} 件</p>
        <RefreshButton onClick={() => void fetchSeekers(query)} loading={loading} />
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : seekers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {archived ? "停止中の求職者はいません。" : "該当する求職者がいません。"}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
              <tr>
                <th className="px-3 py-2.5">メアド / 表示名</th>
                <th className="px-3 py-2.5">最終ログイン</th>
                <th className="px-3 py-2.5 text-right">履歴書</th>
                <th className="px-3 py-2.5 text-right">応募</th>
                <th className="px-3 py-2.5 text-right">AI会話</th>
                <th className="px-3 py-2.5 text-right">連携CA</th>
                <th className="px-3 py-2.5">登録日</th>
                {archived && <th className="px-3 py-2.5">停止日</th>}
              </tr>
            </thead>
            <tbody>
              {seekers.map((s) => (
                <SeekerRowView key={s.id} seeker={s} nowMs={nowMs} archived={archived} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SeekerRowView({
  seeker: s,
  nowMs,
  archived,
}: {
  seeker: SeekerRow;
  nowMs: number;
  archived: boolean;
}) {
  const activitySum =
    s.resumeCount + s.applicationCount + s.conversationCount + s.linkedAgencyCount;
  const isDormant = !archived && activitySum === 0;
  return (
    <tr
      className={`hover:bg-accent/40 odd:bg-muted/10 border-t transition-colors ${
        isDormant ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
      }`}
    >
      <td className="px-3 py-2.5">
        <div className="font-medium">{s.email || "(no email)"}</div>
        <div className="text-muted-foreground text-[10px]">
          {s.displayName ?? "—"} / {s.id}
        </div>
        {!archived && !s.onboardedAt && (
          <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            未オンボード
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs">
        <LastSignInCell iso={s.lastSignInAt} nowMs={nowMs} />
      </td>
      <td className="px-3 py-2.5 text-right text-xs">
        <MetricNumber value={s.resumeCount} />
      </td>
      <td className="px-3 py-2.5 text-right text-xs">
        <MetricNumber value={s.applicationCount} />
      </td>
      <td className="px-3 py-2.5 text-right text-xs">
        <MetricNumber value={s.conversationCount} />
      </td>
      <td className="px-3 py-2.5 text-right text-xs">
        <MetricNumber value={s.linkedAgencyCount} />
      </td>
      <td className="px-3 py-2.5 text-xs">{new Date(s.createdAt).toLocaleDateString("ja-JP")}</td>
      {archived && (
        <td className="px-3 py-2.5 text-xs">
          {s.archivedAt ? new Date(s.archivedAt).toLocaleDateString("ja-JP") : "—"}
          {s.archivedReason && (
            <div className="text-muted-foreground max-w-40 truncate" title={s.archivedReason}>
              {s.archivedReason}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

function MetricNumber({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground/60">0</span>;
  return <span className="font-semibold text-emerald-700 dark:text-emerald-400">{value}</span>;
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
