"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * LIFF 求人詳細 View (Client Component)
 *
 * 役割:
 *   1. LIFF SDK を 初期化 (liff.init({liffId}))
 *   2. ログイン確認、 未ログイン なら liff.login()
 *   3. プロフィール 取得 (userId / displayName)
 *   4. 求人詳細 を 表示
 *   5. 「応募 する」ボタン → /liff/[orgId]/apply/[jobId] へ
 */
import "@/lib/line/liff-types";

type Job = {
  id: string;
  position: string;
  companyName: string;
  employmentType: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  workStyle: string | null;
  requiredSkills: string[];
  preferredSkills: string[];
  description: string | null;
  holidays: string | null;
};

type Props = {
  liffId: string;
  orgId: string;
  organizationName: string;
  job: Job;
};

export function LiffJobView({ liffId, orgId, organizationName, job }: Props) {
  const [liffReady, setLiffReady] = useState(false);
  const [profile, setProfile] = useState<{ userId: string; displayName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        // SDK 読込 待機 (layout で beforeInteractive で 読み込んでいる が タイミング保険)
        for (let i = 0; i < 50; i += 1) {
          if (typeof window !== "undefined" && window.liff) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!window.liff) {
          setError("LIFF SDK 読込 失敗 (LINE アプリ で 開いて ください)");
          return;
        }
        await window.liff.init({ liffId });
        setLiffReady(true);
        if (window.liff.isLoggedIn()) {
          const p = await window.liff.getProfile();
          setProfile({ userId: p.userId, displayName: p.displayName });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "LIFF 初期化 失敗");
      }
    };
    void init();
  }, [liffId]);

  const onLogin = () => {
    if (!window.liff) return;
    window.liff.login({ redirectUri: window.location.href });
  };

  const salary = formatSalary(job.salaryMin, job.salaryMax);

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header className="space-y-1">
        <p className="text-muted-foreground text-xs">{organizationName}</p>
        <h1 className="text-xl font-bold">{job.position}</h1>
        <p className="text-sm text-slate-700">{job.companyName}</p>
      </header>

      <Card className="space-y-2 p-4">
        {job.location && <Row label="勤務地">{job.location}</Row>}
        {job.employmentType && <Row label="雇用形態">{job.employmentType}</Row>}
        {salary && (
          <Row label="想定 年収">
            <span className="font-bold text-emerald-700">{salary}</span>
          </Row>
        )}
        {job.workStyle && <Row label="働き方">{job.workStyle}</Row>}
        {job.holidays && <Row label="休日">{job.holidays}</Row>}
      </Card>

      {job.description && (
        <Card className="space-y-1 p-4">
          <p className="text-xs font-semibold">仕事内容</p>
          <p className="text-sm whitespace-pre-wrap">{job.description}</p>
        </Card>
      )}

      {job.requiredSkills.length > 0 && (
        <Card className="space-y-1 p-4">
          <p className="text-xs font-semibold">必須スキル</p>
          <div className="flex flex-wrap gap-1">
            {job.requiredSkills.map((s) => (
              <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                {s}
              </span>
            ))}
          </div>
        </Card>
      )}

      {job.preferredSkills.length > 0 && (
        <Card className="space-y-1 p-4">
          <p className="text-xs font-semibold">歓迎スキル</p>
          <div className="flex flex-wrap gap-1">
            {job.preferredSkills.map((s) => (
              <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                {s}
              </span>
            ))}
          </div>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="sticky bottom-4">
        {!liffReady ? (
          <Button disabled className="w-full">
            読み込み中...
          </Button>
        ) : !profile ? (
          <Button onClick={onLogin} className="w-full bg-[#06C755] text-white hover:bg-[#05a647]">
            LINE で ログイン して 応募
          </Button>
        ) : (
          <Link
            href={`/liff/${orgId}/apply/${job.id}`}
            className="block w-full rounded-md bg-[#06C755] py-3 text-center font-semibold text-white hover:bg-[#05a647]"
          >
            {profile.displayName} さん として 応募 する
          </Link>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function formatSalary(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const fmt = (v: number) => `${Math.round(v / 10000)} 万円`;
  if (min !== null && max !== null) return `${fmt(min)} 〜 ${fmt(max)}`;
  if (min !== null) return `${fmt(min)} 〜`;
  if (max !== null) return `〜 ${fmt(max)}`;
  return null;
}
