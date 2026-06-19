"use client";

import { Building2, Heart, MapPin, Send } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError, apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { parseJobDescription, sortJobDescriptionSections } from "@/lib/jobs/parse-description";
import type { SeekerJobDetail } from "@/lib/jobs/seeker-queries";
import { formatSalaryRange } from "@/lib/jobs/types";

/**
 * Indeed 風 求人 詳細 表示。
 *
 * 構成:
 *   ヘッダー(企業名 / 職種 / バッジ群 / アクションボタン)
 *   ★ セクション(仕事内容 / 募集背景 / 配属先 / ポイント / 特徴 / 給与備考 /
 *      福利厚生 / 会社情報 / 求人ID。AI 抽出時のみ ★ で 区切られている)
 *   応募条件 / 歓迎条件
 *   勤務条件テーブル(勤務地 / 勤務時間 / 休日 / 試用期間 / 雇用形態 / 喫煙対策 /
 *      業務の変更範囲 / 勤務地の変更範囲)
 *   下部 sticky CTA(モバイル)
 *
 * アクションは /api/me/job-recommendations/[id]/interest と /apply を 既存利用。
 */
type Props = {
  job: SeekerJobDetail;
  initiallyInterested: boolean;
  initiallyRequested: boolean;
};

export function SeekerJobDetailView({ job, initiallyInterested, initiallyRequested }: Props) {
  const [interested, setInterested] = useState(initiallyInterested);
  const [requested, setRequested] = useState(initiallyRequested);
  const [error, setError] = useState<string | null>(null);
  const [isInterestPending, startInterestTransition] = useTransition();
  const [isApplyPending, startApplyTransition] = useTransition();

  const toggleInterest = () => {
    startInterestTransition(async () => {
      const wasInterested = interested;
      setInterested(!wasInterested);
      setError(null);
      try {
        await apiFetch(`/api/me/job-recommendations/${job.id}/interest`, {
          method: wasInterested ? "DELETE" : "POST",
        });
      } catch (err) {
        setInterested(wasInterested);
        setError(getErrorMessage(err));
      }
    });
  };

  const requestApply = () => {
    if (!confirm("この求人への応募を エージェントに 依頼しますか?")) return;
    startApplyTransition(async () => {
      setError(null);
      try {
        await apiFetch(`/api/me/job-recommendations/${job.id}/apply`, { method: "POST" });
        setRequested(true);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 409) {
          setRequested(true);
        } else {
          setError(getErrorMessage(err));
        }
      }
    });
  };

  const sections = sortJobDescriptionSections(parseJobDescription(job.description));
  const features = extractFeatureBadges(sections);

  return (
    <div className="space-y-4 pb-24 sm:pb-4">
      {/* ヘッダー */}
      <Card className="space-y-3 p-5">
        <div className="space-y-1">
          <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Building2 className="h-3 w-3" />
            {job.organizationName}
          </p>
          <h1 className="text-xl leading-tight font-bold sm:text-2xl">{job.companyName}</h1>
          <p className="text-foreground/80 text-base sm:text-lg">{job.position}</p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {formatSalaryRange(job.salaryMin, job.salaryMax) !== "応相談" && (
            <Badge tone="primary">年収 {formatSalaryRange(job.salaryMin, job.salaryMax)}</Badge>
          )}
          {job.location && (
            <Badge tone="muted">
              <MapPin className="mr-0.5 h-3 w-3" />
              {job.location}
            </Badge>
          )}
          {job.employmentType && <Badge tone="muted">{job.employmentType}</Badge>}
          {features.map((f) => (
            <Badge key={f} tone="accent">
              {f}
            </Badge>
          ))}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* デスクトップ用 トップ CTA(モバイルは 下部 sticky) */}
        <div className="hidden gap-2 sm:flex">
          <Button
            type="button"
            variant={interested ? "outline" : "ghost"}
            onClick={toggleInterest}
            disabled={isInterestPending}
          >
            <Heart className={`mr-1 h-4 w-4 ${interested ? "fill-current" : ""}`} />
            {interested ? "興味あり 取り消す" : "興味あり"}
          </Button>
          {requested ? (
            <>
              <Button type="button" variant="outline" disabled>
                依頼済み
              </Button>
              <Button type="button" variant="ghost" render={<Link href="/app/agent-referrals" />}>
                進捗を見る →
              </Button>
            </>
          ) : (
            <Button type="button" onClick={requestApply} disabled={isApplyPending}>
              <Send className="mr-1 h-4 w-4" />
              {isApplyPending ? "依頼中..." : "応募を 依頼"}
            </Button>
          )}
        </div>
      </Card>

      {/* description セクション群 */}
      {sections.length > 0 && (
        <Card className="space-y-5 p-5">
          {sections.map((s, i) => (
            <section key={`${s.title ?? "intro"}-${i}`} className="space-y-2">
              {s.title && (
                <h2 className="border-b pb-1 text-sm font-semibold text-slate-700">{s.title}</h2>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">{s.body}</p>
            </section>
          ))}
        </Card>
      )}

      {/* 応募条件 / 歓迎条件 */}
      {(job.requiredSkills || job.preferredSkills || job.applicationQualifications) && (
        <Card className="space-y-4 p-5">
          {job.applicationQualifications && (
            <section className="space-y-2">
              <h2 className="border-b pb-1 text-sm font-semibold text-slate-700">応募資格</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
                {job.applicationQualifications}
              </p>
            </section>
          )}
          {job.requiredSkills && (
            <section className="space-y-2">
              <h2 className="border-b pb-1 text-sm font-semibold text-slate-700">必須条件</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
                {job.requiredSkills}
              </p>
            </section>
          )}
          {job.preferredSkills && (
            <section className="space-y-2">
              <h2 className="border-b pb-1 text-sm font-semibold text-slate-700">歓迎条件</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
                {job.preferredSkills}
              </p>
            </section>
          )}
        </Card>
      )}

      {/* 勤務条件 テーブル */}
      <Card className="space-y-2 p-5">
        <h2 className="border-b pb-1 text-sm font-semibold text-slate-700">勤務条件</h2>
        <dl className="grid grid-cols-[7em_1fr] gap-x-3 gap-y-2 text-sm">
          <Row label="勤務地" value={job.location} />
          <Row label="雇用形態" value={job.employmentType} />
          <Row label="勤務時間" value={job.workHours} />
          <Row label="休憩時間" value={job.breakTime} />
          <Row label="休日休暇" value={job.holidays} />
          <Row label="試用期間" value={job.probationPeriod} />
          <Row label="受動喫煙対策" value={job.smokingPreventionMeasure} />
          <Row label="業務(変更の範囲)" value={job.workChangeScope} />
          <Row label="勤務地(変更の範囲)" value={job.locationChangeScope} />
        </dl>
      </Card>

      {/* モバイル下部 sticky CTA */}
      <div className="bg-background fixed inset-x-0 bottom-0 z-30 border-t p-3 shadow-lg sm:hidden">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Button
            type="button"
            variant={interested ? "outline" : "ghost"}
            onClick={toggleInterest}
            disabled={isInterestPending}
            className="flex-1"
          >
            <Heart className={`mr-1 h-4 w-4 ${interested ? "fill-current" : ""}`} />
            {interested ? "解除" : "興味あり"}
          </Button>
          {requested ? (
            <Button
              type="button"
              variant="outline"
              render={<Link href="/app/agent-referrals" />}
              className="flex-1"
            >
              進捗を見る
            </Button>
          ) : (
            <Button
              type="button"
              onClick={requestApply}
              disabled={isApplyPending}
              className="flex-1"
            >
              <Send className="mr-1 h-4 w-4" />
              {isApplyPending ? "依頼中..." : "応募を 依頼"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value || "—"}</dd>
    </>
  );
}

type BadgeTone = "primary" | "muted" | "accent";

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const cls =
    tone === "primary"
      ? "bg-emerald-100 text-emerald-800"
      : tone === "accent"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${cls}`}>
      {children}
    </span>
  );
}

/**
 * description の 「特徴」セクションに 並んだ タグを 抽出して 上部に バッジ表示する。
 * AI プロンプトで 「土日休み / 副業OK / フルリモート 等 を 1 行に 並べる」と
 * 指示しているので、空白 / 全角空白 / "・" / "/" で 分割して 拾う。
 */
function extractFeatureBadges(sections: ReturnType<typeof parseJobDescription>): string[] {
  const feat = sections.find((s) => s.title === "特徴");
  if (!feat) return [];
  return feat.body
    .split(/[\s・、,\/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 12)
    .slice(0, 8);
}
