"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  updateJobRequestSchema,
  type UpdateJobRequest,
  type JobPosting,
  jobStatusLabels,
} from "@/lib/jobs/types";
import { JobImageUploader } from "@/components/features/agency/job-image-uploader";
import { LabourProgressBadge } from "@/components/features/agency/labour-progress-badge";

// salary_min / salary_max は z.preprocess で input 型が unknown になるため、
// useForm の入出力ジェネリクスを分けないと defaultValues / resolver の型整合が取れない。
type UpdateJobFormInput = z.input<typeof updateJobRequestSchema>;
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 求人詳細編集フォーム
 *
 * new/job-form.tsx とほぼ同じ作りだが、初期値を既存レコードから取り、
 * PATCH /api/agency/jobs/[id] を呼ぶ。保存成功時は router.refresh() で再取得。
 */

type Props = {
  job: JobPosting;
  /** Server Component で 計算 した hero_image_path の public URL */
  heroImageUrl: string | null;
  /** Server Component で 計算 した line_share_image_path の public URL */
  lineShareImageUrl: string | null;
};

export function JobDetailForm({ job, heroImageUrl, lineShareImageUrl }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<UpdateJobFormInput, unknown, UpdateJobRequest>({
    resolver: zodResolver(updateJobRequestSchema),
    defaultValues: {
      company_name: job.companyName,
      position: job.position,
      employment_type: job.employmentType ?? "",
      location: job.location ?? "",
      salary_min: job.salaryMin,
      salary_max: job.salaryMax,
      description: job.description ?? "",
      required_skills: job.requiredSkills ?? "",
      preferred_skills: job.preferredSkills ?? "",
      status: job.status,
      work_change_scope: job.workChangeScope ?? "",
      location_change_scope: job.locationChangeScope ?? "",
      smoking_prevention_measure: job.smokingPreventionMeasure ?? "",
      probation_period: job.probationPeriod ?? "",
      work_hours: job.workHours ?? "",
      break_time: job.breakTime ?? "",
      holidays: job.holidays ?? "",
      application_qualifications: job.applicationQualifications ?? "",
      // 成約報酬。 求職者 に は 露出 しない (agency-private)。
      placement_fee: job.placementFee,
    },
  });

  const onSubmit: SubmitHandler<UpdateJobRequest> = (data) => {
    startTransition(async () => {
      setServerError(null);
      setSuccessMessage(null);
      try {
        const response = await fetch(`/api/agency/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "保存に失敗しました");
        }
        setSuccessMessage("保存しました");
        router.refresh();
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>エラー: {serverError}</AlertDescription>
          </Alert>
        )}
        {successMessage && (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {/* 画像 セクション (form 外部 と 通信、 即時 反映) */}
        <div className="space-y-4 rounded-md border bg-slate-50/30 p-4">
          <div>
            <h3 className="text-sm font-semibold">求人 画像</h3>
            <p className="text-muted-foreground text-[10px]">
              保存 ボタン と は 別 に 即時 反映 されます。 差し替え / 削除 も ここ から。
            </p>
          </div>
          <JobImageUploader
            jobId={job.id}
            kind="hero"
            label="メイン 画像 (求人 詳細 / 一覧)"
            description="サイト 上 や 求職者 向け 詳細 で 使う 画像"
            initialImageUrl={heroImageUrl}
          />
          <JobImageUploader
            jobId={job.id}
            kind="line_share"
            label="LINE 配信 用 画像 (任意)"
            description="設定 する と LINE 求人カード で 優先 使用。 未設定 ならメイン画像 を 使用"
            initialImageUrl={lineShareImageUrl}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="company_name">
            求人企業名 <span className="text-red-600">*</span>
          </Label>
          <Input id="company_name" {...register("company_name")} disabled={isPending} />
          {errors.company_name && (
            <p className="text-sm text-red-600">{errors.company_name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="position">
            職種・ポジション <span className="text-red-600">*</span>
          </Label>
          <Input id="position" {...register("position")} disabled={isPending} />
          {errors.position && <p className="text-sm text-red-600">{errors.position.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="employment_type">雇用形態</Label>
          <Input id="employment_type" {...register("employment_type")} disabled={isPending} />
          {errors.employment_type && (
            <p className="text-sm text-red-600">{errors.employment_type.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">勤務地</Label>
          <Input id="location" {...register("location")} disabled={isPending} />
          {errors.location && <p className="text-sm text-red-600">{errors.location.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="salary_min">年収下限(万円)</Label>
            <Input
              id="salary_min"
              type="number"
              min="0"
              max="100000"
              {...register("salary_min")}
              disabled={isPending}
            />
            {errors.salary_min && (
              <p className="text-sm text-red-600">{errors.salary_min.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="salary_max">年収上限(万円)</Label>
            <Input
              id="salary_max"
              type="number"
              min="0"
              max="100000"
              {...register("salary_max")}
              disabled={isPending}
            />
            {errors.salary_max && (
              <p className="text-sm text-red-600">{errors.salary_max.message}</p>
            )}
          </div>
        </div>

        {/* 成約報酬 (agency-private)。 求職者側 の 画面 / API に は 一切 露出 しない。 */}
        <div className="space-y-2">
          <Label htmlFor="placement_fee" className="flex items-center gap-2">
            <span>成約報酬(万円)</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              非公開・求職者には見えません
            </span>
          </Label>
          <Input
            id="placement_fee"
            type="number"
            min="0"
            max="100000"
            {...register("placement_fee")}
            disabled={isPending}
            placeholder="例:120"
          />
          <p className="text-muted-foreground text-xs">
            <a
              href="/agency/settings/ai-recommendation"
              className="text-primary underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              AI 推薦の傾き設定
            </a>
            で「バランス」や「報酬重視」を選ぶと、 この金額を考慮したランキングになります。
            求職者には金額は一切見えません。
          </p>
          {errors.placement_fee && (
            <p className="text-sm text-red-600">{errors.placement_fee.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">仕事内容</Label>
          <textarea
            id="description"
            {...register("description")}
            disabled={isPending}
            rows={5}
            className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors.description && (
            <p className="text-sm text-red-600">{errors.description.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="required_skills">必須条件</Label>
          <textarea
            id="required_skills"
            {...register("required_skills")}
            disabled={isPending}
            rows={3}
            className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors.required_skills && (
            <p className="text-sm text-red-600">{errors.required_skills.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="preferred_skills">歓迎条件</Label>
          <textarea
            id="preferred_skills"
            {...register("preferred_skills")}
            disabled={isPending}
            rows={3}
            className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors.preferred_skills && (
            <p className="text-sm text-red-600">{errors.preferred_skills.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">ステータス</Label>
          <select
            id="status"
            {...register("status")}
            disabled={isPending}
            className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
          >
            {Object.entries(jobStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* 法定明示事項(2024年改正労基法 + 健康増進法対応)
            セクション見出しを出して既存項目と区別する。すべて任意入力。 */}
        <div className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">
              法定明示事項(2024年改正労基法対応)
            </p>
            <LabourProgressBadge control={control} />
          </div>
          <p className="text-muted-foreground text-xs">
            すべて任意入力。求人 OGP・配信時の見え方の参考になります。
          </p>

          <div className="space-y-2">
            <Label htmlFor="work_change_scope">業務内容(変更の範囲)</Label>
            <textarea
              id="work_change_scope"
              {...register("work_change_scope")}
              disabled={isPending}
              rows={2}
              placeholder="例:入社後に異動の可能性がある業務範囲"
              className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location_change_scope">就業場所(変更の範囲)</Label>
            <textarea
              id="location_change_scope"
              {...register("location_change_scope")}
              disabled={isPending}
              rows={2}
              placeholder="例:本社、東日本支社、リモートあり"
              className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="smoking_prevention_measure">受動喫煙防止措置</Label>
            <Input
              id="smoking_prevention_measure"
              {...register("smoking_prevention_measure")}
              disabled={isPending}
              placeholder="例:屋内禁煙"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="probation_period">試用期間</Label>
            <Input
              id="probation_period"
              {...register("probation_period")}
              disabled={isPending}
              placeholder="例:3か月(待遇に変更なし)"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="work_hours">勤務時間</Label>
              <Input
                id="work_hours"
                {...register("work_hours")}
                disabled={isPending}
                placeholder="例:9:00-18:00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="break_time">休憩時間</Label>
              <Input
                id="break_time"
                {...register("break_time")}
                disabled={isPending}
                placeholder="例:60分"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="holidays">休日休暇</Label>
            <textarea
              id="holidays"
              {...register("holidays")}
              disabled={isPending}
              rows={2}
              placeholder="例:完全週休2日、土日祝、GW、夏季、年末年始"
              className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="application_qualifications">応募資格</Label>
            <textarea
              id="application_qualifications"
              {...register("application_qualifications")}
              disabled={isPending}
              rows={3}
              placeholder="例:Webアプリ開発経験3年以上、TypeScript 実務歴 など"
              className="border-input bg-background field-sizing-content w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>
    </Card>
  );
}

// LabourProgressBadge は components/features/agency/labour-progress-badge.tsx に
// 共通化(編集 / 新規登録の両方で再利用)。
