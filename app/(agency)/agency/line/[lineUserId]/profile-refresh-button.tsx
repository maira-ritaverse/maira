"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * プロフィール 再取得 ボタン (連絡先 詳細 サイドバー 内)
 *
 * LINE API から display_name / picture_url を 取り直し、
 * 成功 したら ページ を 再読み込み して 反映。
 */
type Props = { lineUserId: string };

export function ProfileRefreshButton({ lineUserId }: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agency/line/refresh-profile/${encodeURIComponent(lineUserId)}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onClick}
        disabled={refreshing}
        className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-emerald-700 disabled:opacity-50"
        title="LINE プロフィール を 再取得"
      >
        <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
        {refreshing ? "更新中..." : "プロフィール 更新"}
      </button>
      {error && <p className="mt-1 text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
