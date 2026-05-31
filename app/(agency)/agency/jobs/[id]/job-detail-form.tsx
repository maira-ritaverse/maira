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

type Props = { job: JobPosting };

export function JobDetailForm({ job }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
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

        <div className="space-y-2">
          <Label htmlFor="description">仕事内容</Label>
          <textarea
            id="description"
            {...register("description")}
            disabled={isPending}
            rows={5}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
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
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
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
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
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
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {Object.entries(jobStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>
    </Card>
  );
}
