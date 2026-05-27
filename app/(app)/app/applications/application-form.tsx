"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applicationDetailsSchema,
  applicationStatuses,
  applicationStatusLabels,
  type Application,
  type ApplicationDetails,
  type ApplicationStatus,
} from "@/lib/applications/types";

/**
 * 応募の新規作成・編集フォーム(共通コンポーネント)
 *
 * - details(会社名・職種・URL・メモなど)は react-hook-form + zod で管理
 * - status / applied_at / next_action_at はメタデータなので別 state で扱う
 *   (zod スキーマは details のみを対象にしているため)
 *
 * 編集時は existing を渡すと初期値が入る。mode で API のメソッドと遷移先を切り替え。
 */

type Props = { mode: "create"; existing?: undefined } | { mode: "edit"; existing: Application };

export function ApplicationForm(props: Props) {
  const { mode, existing } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const [status, setStatus] = useState<ApplicationStatus>(existing?.status ?? "considering");
  // <input type="date"> は YYYY-MM-DD、datetime-local は YYYY-MM-DDTHH:mm 形式を期待。
  // DB の timestamptz(ISO 文字列)から先頭だけ切り出す。
  const [appliedAt, setAppliedAt] = useState<string>(existing?.applied_at?.slice(0, 10) ?? "");
  const [nextActionAt, setNextActionAt] = useState<string>(
    existing?.next_action_at?.slice(0, 16) ?? "",
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ApplicationDetails>({
    resolver: zodResolver(applicationDetailsSchema),
    defaultValues: existing?.details ?? {
      company: "",
      position: "",
      job_url: "",
      notes: "",
      salary_range: "",
      location: "",
    },
  });

  const onSubmit = (data: ApplicationDetails) => {
    startTransition(async () => {
      setServerError(null);
      try {
        // 日付/日時は UTC 扱いで送る(timestamptz は ISO で受ければ DB 側で解釈)
        const payload = {
          details: data,
          status,
          applied_at: appliedAt ? `${appliedAt}T00:00:00Z` : null,
          next_action_at: nextActionAt ? `${nextActionAt}:00Z` : null,
        };

        const url = mode === "create" ? "/api/applications" : `/api/applications/${existing.id}`;
        const method = mode === "create" ? "POST" : "PATCH";

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errData = (await response.json()) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "Save failed");
        }

        if (mode === "create") {
          const result = (await response.json()) as { id: string };
          router.push(`/app/applications/${result.id}`);
        } else {
          router.refresh();
        }
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
          <Label htmlFor="company">
            会社名 <span className="text-red-600">*</span>
          </Label>
          <Input
            id="company"
            {...register("company")}
            disabled={isPending}
            placeholder="例:株式会社○○"
          />
          {errors.company && <p className="text-sm text-red-600">{errors.company.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="position">
            職種 <span className="text-red-600">*</span>
          </Label>
          <Input
            id="position"
            {...register("position")}
            disabled={isPending}
            placeholder="例:プロダクトマネージャー"
          />
          {errors.position && <p className="text-sm text-red-600">{errors.position.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">ステータス</Label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {applicationStatuses.map((s) => (
              <option key={s} value={s}>
                {applicationStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="applied_at">応募日</Label>
            <Input
              id="applied_at"
              type="date"
              value={appliedAt}
              onChange={(e) => setAppliedAt(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next_action_at">次のアクション期限</Label>
            <Input
              id="next_action_at"
              type="datetime-local"
              value={nextActionAt}
              onChange={(e) => setNextActionAt(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="job_url">求人URL</Label>
          <Input
            id="job_url"
            type="url"
            {...register("job_url")}
            disabled={isPending}
            placeholder="https://..."
          />
          {errors.job_url && <p className="text-sm text-red-600">{errors.job_url.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="salary_range">想定年収</Label>
            <Input
              id="salary_range"
              {...register("salary_range")}
              disabled={isPending}
              placeholder="例:600-800万"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">勤務地</Label>
            <Input
              id="location"
              {...register("location")}
              disabled={isPending}
              placeholder="例:東京"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">メモ</Label>
          <textarea
            id="notes"
            {...register("notes")}
            disabled={isPending}
            rows={4}
            placeholder="自由メモ"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "保存中..." : mode === "create" ? "登録する" : "保存"}
        </Button>
      </form>
    </Card>
  );
}
