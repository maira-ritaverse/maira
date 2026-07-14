"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createJobRequestSchema, type CreateJobRequest, jobStatusLabels } from "@/lib/jobs/types";
import { LabourProgressBadge } from "@/components/features/agency/labour-progress-badge";

// zod スキーマで status に .default() を付けているため、入力型(default 前)と
// 出力型(default 適用後)が一致しない。useForm の入出力ジェネリクスを分けないと
// resolver の型整合が取れない。
type CreateJobFormInput = z.input<typeof createJobRequestSchema>;
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ParseDocumentButton } from "./parse-document-button";

/**
 * 求人新規登録フォーム
 *
 * 既存の ClientForm と同じパターン(react-hook-form + zodResolver + useTransition)。
 * 年収は <input type="number"> + register の valueAsNumber=false で扱い、
 * 空欄を許容する。zod 側の salaryField プリプロセッサで空文字→null に変換する。
 */
export function JobForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset: resetForm,
    getValues,
    formState: { errors },
  } = useForm<CreateJobFormInput, unknown, CreateJobRequest>({
    resolver: zodResolver(createJobRequestSchema),
    defaultValues: {
      company_name: "",
      position: "",
      employment_type: "",
      location: "",
      salary_min: null,
      salary_max: null,
      description: "",
      required_skills: "",
      preferred_skills: "",
      status: "open",
      work_change_scope: "",
      location_change_scope: "",
      smoking_prevention_measure: "",
      probation_period: "",
      work_hours: "",
      break_time: "",
      holidays: "",
      application_qualifications: "",
      // 成約報酬。 求職者 に は 露出 しない (agency-private)。 空欄 は null 扱い。
      placement_fee: null,
    },
  });

  const onSubmit: SubmitHandler<CreateJobRequest> = (data) => {
    startTransition(async () => {
      setServerError(null);
      try {
        const response = await fetch("/api/agency/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "登録に失敗しました");
        }
        const result = (await response.json()) as { id: string };
        router.push(`/agency/jobs/${result.id}`);
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

        <ParseDocumentButton
          disabled={isPending}
          onApply={(d) => {
            // AI 抽出結果で フォームを 上書き(salary は number | "" → number | null に 寄せる)
            resetForm({
              company_name: d.company_name,
              position: d.position,
              employment_type: d.employment_type,
              location: d.location,
              salary_min: d.salary_min === "" ? null : d.salary_min,
              salary_max: d.salary_max === "" ? null : d.salary_max,
              description: d.description,
              required_skills: d.required_skills,
              preferred_skills: d.preferred_skills,
              status: "open",
              work_change_scope: d.work_change_scope,
              location_change_scope: d.location_change_scope,
              smoking_prevention_measure: d.smoking_prevention_measure,
              probation_period: d.probation_period,
              work_hours: d.work_hours,
              break_time: d.break_time,
              holidays: d.holidays,
              application_qualifications: d.application_qualifications,
              // 成約報酬 は AI 抽出 対象 外 (求人票 から は 取れ ない agency-private 情報)。
              // resetForm は 明示 されない フィールド を undefined に 飛ばす ので、
              // ユーザー が 先に 入力 して いた 値 を getValues で 明示 に 保持 する。
              placement_fee: getValues("placement_fee"),
            });
          }}
        />

        <div className="space-y-2">
          <Label htmlFor="company_name">
            求人企業名 <span className="text-red-600">*</span>
          </Label>
          <Input
            id="company_name"
            {...register("company_name")}
            disabled={isPending}
            placeholder="例:株式会社サンプル"
          />
          {errors.company_name && (
            <p className="text-sm text-red-600">{errors.company_name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="position">
            職種・ポジション <span className="text-red-600">*</span>
          </Label>
          <Input
            id="position"
            {...register("position")}
            disabled={isPending}
            placeholder="例:バックエンドエンジニア"
          />
          {errors.position && <p className="text-sm text-red-600">{errors.position.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="employment_type">雇用形態</Label>
          <Input
            id="employment_type"
            {...register("employment_type")}
            disabled={isPending}
            placeholder="例:正社員"
          />
          {errors.employment_type && (
            <p className="text-sm text-red-600">{errors.employment_type.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">勤務地</Label>
          <Input
            id="location"
            {...register("location")}
            disabled={isPending}
            placeholder="例:東京都渋谷区"
          />
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
              placeholder="例:500"
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
              placeholder="例:700"
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
            AI 推薦の 傾き(設定 → AI 求人推薦の 設定)で「バランス」や「報酬重視」を 選ぶと、 この
            金額を 考慮 した ランキング に なります。 求職者には 金額は 一切 見えません。
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
            placeholder="業務内容、開発環境、チーム構成など"
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
            placeholder="必須スキル・経験"
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
            placeholder="歓迎スキル・経験"
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

        {/* 法定明示事項(編集画面と同じ見た目で揃える)
            任意入力なので、登録時にスキップしても OK と分かるよう枠で区別する。 */}
        <div className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">
              法定明示事項(2024年改正労基法対応)
            </p>
            <LabourProgressBadge control={control} />
          </div>
          <p className="text-muted-foreground text-xs">
            すべて任意入力。後から編集画面で追加することもできます。
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
          {isPending ? "登録中..." : "登録する"}
        </Button>
      </form>
    </Card>
  );
}
