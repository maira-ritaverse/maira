"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createJobRequestSchema, type CreateJobRequest, jobStatusLabels } from "@/lib/jobs/types";

// zod スキーマで status に .default() を付けているため、入力型(default 前)と
// 出力型(default 適用後)が一致しない。useForm の入出力ジェネリクスを分けないと
// resolver の型整合が取れない。
type CreateJobFormInput = z.input<typeof createJobRequestSchema>;
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

        <div className="space-y-2">
          <Label htmlFor="description">仕事内容</Label>
          <textarea
            id="description"
            {...register("description")}
            disabled={isPending}
            rows={5}
            placeholder="業務内容、開発環境、チーム構成など"
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
            placeholder="必須スキル・経験"
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
            placeholder="歓迎スキル・経験"
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
          {isPending ? "登録中..." : "登録する"}
        </Button>
      </form>
    </Card>
  );
}
