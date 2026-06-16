"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type KpiResponse = {
  generatedAt: string;
  cumulative: {
    userCount: number | null;
    seekerCount: number | null;
    memberCount: number | null;
    organizationCount: number | null;
    resumeCount: number | null;
    cvCount: number | null;
    applicationCount: number | null;
    placementCount: number | null;
    careerProfileCount: number | null;
  };
  last30d: {
    newUsers: number | null;
    applicationsCreated: number | null;
    placementsCreated: number | null;
  };
  lead: {
    signupInquiryTotal: number;
    convertedTotal: number;
    conversionRatePct: number | null;
  };
};

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());

export function KpiDashboard() {
  const [data, setData] = useState<KpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void (async () => {
      try {
        const res = await apiFetch<KpiResponse>(`/api/admin/kpi`);
        setData(res ?? null);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-muted-foreground text-sm">読み込み中…</p>;
  if (error) return <p className="text-destructive text-xs">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">データなし。</p>;

  const c = data.cumulative;
  const r = data.last30d;
  const lead = data.lead;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-semibold">累計</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="全ユーザ数" value={fmt(c.userCount)} />
          <KpiCard label="求職者" value={fmt(c.seekerCount)} />
          <KpiCard label="エージェントメンバー" value={fmt(c.memberCount)} />
          <KpiCard label="エージェント企業" value={fmt(c.organizationCount)} />
          <KpiCard label="履歴書" value={fmt(c.resumeCount)} />
          <KpiCard label="職務経歴書" value={fmt(c.cvCount)} />
          <KpiCard label="応募" value={fmt(c.applicationCount)} />
          <KpiCard label="成約イベント" value={fmt(c.placementCount)} />
          <KpiCard label="キャリア棚卸し完了" value={fmt(c.careerProfileCount)} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">直近 30 日</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="新規登録ユーザ" value={fmt(r.newUsers)} />
          <KpiCard label="新規応募" value={fmt(r.applicationsCreated)} />
          <KpiCard label="新規成約イベント" value={fmt(r.placementsCreated)} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">新規導入リード(累計)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="新規導入の問い合わせ" value={lead.signupInquiryTotal.toLocaleString()} />
          <KpiCard label="そこから発行できた数" value={lead.convertedTotal.toLocaleString()} />
          <KpiCard
            label="成約率"
            value={lead.conversionRatePct === null ? "—" : `${lead.conversionRatePct}%`}
          />
        </div>
        <p className="text-muted-foreground mt-2 text-[10px]">
          ※ 成約率 =「ログイン画面の問い合わせフォーム経由で送られたリード」のうち 「運営者が
          `この企業を発行する` で実際に発行した数」÷「リード総数」。
          受信箱から離れて発行された場合はこの数字には含まれません。
        </p>
      </div>

      <p className="text-muted-foreground text-[10px]">
        生成時刻:{new Date(data.generatedAt).toLocaleString("ja-JP")}
      </p>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
